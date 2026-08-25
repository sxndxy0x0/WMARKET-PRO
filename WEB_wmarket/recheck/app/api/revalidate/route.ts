import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { fetchServers, marketTag, isValidServerName, normalizeApiUrl, serverIdentityKey } from '@/lib/api';

// LiveRefresh coalesces browser events for ~1.1s. Keep this just below that
// interval so legitimate consecutive price updates are not silently dropped
// by a 3s server-side throttle (which would leave the Data Cache stale until
// the 15s safety revalidation). The separate per-IP limit remains 1s.
const MIN_INTERVAL_MS = 1_000;
const MAX_TRACKED_SERVERS = 128;
const MIN_IP_INTERVAL_MS = 1_000;
const MAX_TRACKED_IPS = 2048;

// Bounded in-process debounce. Server names are checked against the backend's
// current dynamic server registry before this map is touched.
const lastRevalidatedAt = new Map<string, number>();
const lastRequestAtByIp = new Map<string, number>();


function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || req.headers.get('x-real-ip')?.trim() || 'unknown';
}

function rememberIp(ip: string, now: number) {
  lastRequestAtByIp.delete(ip);
  lastRequestAtByIp.set(ip, now);
  while (lastRequestAtByIp.size > MAX_TRACKED_IPS) {
    const oldest = lastRequestAtByIp.keys().next().value;
    if (!oldest) break;
    lastRequestAtByIp.delete(oldest);
  }
}

function rememberRevalidation(server: string, now: number) {
  lastRevalidatedAt.delete(server);
  lastRevalidatedAt.set(server, now);
  while (lastRevalidatedAt.size > MAX_TRACKED_SERVERS) {
    const oldest = lastRevalidatedAt.keys().next().value;
    if (!oldest) break;
    lastRevalidatedAt.delete(oldest);
  }
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  // This endpoint is called by the browser only. Require an Origin header
  // and compare it with the externally visible host when the app is behind
  // a reverse proxy. Falling back to the internal Host header alone would
  // reject legitimate deployments such as Vercel/Cloudflare -> Next.
  if (!origin) {
    return NextResponse.json({ error: 'origin header required' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    const originUrl = new URL(origin);
    const configuredSiteUrl = normalizeApiUrl(process.env.NEXT_PUBLIC_SITE_URL?.trim() || '');
    const forwardedHostValues = req.headers.get('x-forwarded-host')?.split(',').map((value) => value.trim()).filter(Boolean) ?? [];
    const forwardedProtoValues = req.headers.get('x-forwarded-proto')?.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean) ?? [];
    const forwardedHost = forwardedHostValues[0];
    const forwardedProto = forwardedProtoValues[0];

    // In production, the public site origin must be explicitly configured.
    // Never trust client-supplied X-Forwarded-* headers as the sole CSRF
    // boundary: if this route is accidentally exposed directly, an attacker
    // could otherwise spoof both Origin and X-Forwarded-Host. Behind a proxy,
    // NEXT_PUBLIC_SITE_URL remains the authoritative external origin.
    if (process.env.NODE_ENV === 'production' && !configuredSiteUrl) {
      return NextResponse.json({ error: 'NEXT_PUBLIC_SITE_URL is not configured' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
    }

    const host = configuredSiteUrl ? new URL(configuredSiteUrl).host : req.headers.get('host');
    const expectedOrigin = configuredSiteUrl ? new URL(configuredSiteUrl).origin : `${originUrl.protocol}//${host ?? ''}`;
    const expectedHost = configuredSiteUrl ? new URL(configuredSiteUrl).host : host;
    // `host` (from the Host header) may legitimately be null; compare against
    // a normalized string so the strict-null check reflects real behavior.
    const proxyHostMatches = !configuredSiteUrl || !forwardedHost || forwardedHost.toLowerCase() === (expectedHost ?? '').toLowerCase();
    if (
      !host ||
      originUrl.origin !== expectedOrigin ||
      originUrl.host !== expectedHost ||
      !['http:', 'https:'].includes(originUrl.protocol) ||
      !proxyHostMatches ||
      (forwardedProto && forwardedProto !== originUrl.protocol.slice(0, -1))
    ) {
      return NextResponse.json({ error: 'invalid request origin' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
    }
  } catch {
    return NextResponse.json({ error: 'invalid request origin' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }

  const rawContentLength = req.headers.get('content-length');
  const contentLength = rawContentLength === null ? null : Number(rawContentLength);
  if (contentLength !== null && (!Number.isFinite(contentLength) || contentLength < 0)) {
    return NextResponse.json({ error: 'invalid content length' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  if (contentLength !== null && contentLength > 8_192) {
    return NextResponse.json({ error: 'request body too large' }, { status: 413, headers: { 'Cache-Control': 'no-store' } });
  }

  let body: unknown;
  try {
    if (!req.body) throw new Error('missing request body');
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > 8_192) {
          await reader.cancel();
          throw new Error('request body too large');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (error instanceof Error && error.message === 'request body too large') {
      return NextResponse.json({ error: 'request body too large' }, { status: 413, headers: { 'Cache-Control': 'no-store' } });
    }
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  const now = Date.now();
  const ip = getClientIp(req);
  const lastIpRequest = lastRequestAtByIp.get(ip) ?? 0;
  if (now - lastIpRequest < MIN_IP_INTERVAL_MS) {
    return NextResponse.json({ ok: true, revalidated: false }, { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': '1' } });
  }
  rememberIp(ip, now);

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'request body must be an object' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  const server = (body as { server?: unknown }).server;
  if (typeof server !== 'string' || !isValidServerName(server)) {
    return NextResponse.json({ error: '"server" must be a non-empty string up to 100 characters' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }


  let knownServers;
  try {
    knownServers = await fetchServers();
  } catch {
    return NextResponse.json({ error: 'server registry unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  const requestedKey = serverIdentityKey(server);
  const known = knownServers.some((entry) => serverIdentityKey(entry.name) === requestedKey);
  if (!known) {
    return NextResponse.json({ error: 'server is not registered' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }

  const canonicalServer = knownServers.find((entry) => serverIdentityKey(entry.name) === requestedKey)?.name ?? server;
  const last = lastRevalidatedAt.get(canonicalServer) ?? 0;
  const responseHeaders = { 'Cache-Control': 'no-store' };
  if (now - last < MIN_INTERVAL_MS) {
    return NextResponse.json({ ok: true, revalidated: false }, { headers: responseHeaders });
  }

  rememberRevalidation(canonicalServer, now);
  revalidateTag(marketTag(canonicalServer), { expire: 0 });
  return NextResponse.json({ ok: true, revalidated: true }, { headers: responseHeaders });
}
