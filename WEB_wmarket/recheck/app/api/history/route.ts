import { NextRequest, NextResponse } from 'next/server';
import { fetchServers, marketTag, normalizeApiUrl, canonicalServerName, isValidServerName, serverIdentityKey } from '@/lib/api';

const API_URL = normalizeApiUrl(process.env.NEXT_PUBLIC_API_URL?.trim() || '');
const TIMEOUT_MS = 15_000;
const MAX_LIMIT = 500;
const MAX_ITEM_ID_LENGTH = 200;

export async function GET(request: NextRequest) {
  if (!API_URL) {
    return NextResponse.json(
      { error: 'NEXT_PUBLIC_API_URL is not configured' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const serverParam = request.nextUrl.searchParams.get('server')?.trim() || '';
  const itemParam = request.nextUrl.searchParams.get('item')?.trim() || '';
  const rawLimit = request.nextUrl.searchParams.get('limit');
  const limit = rawLimit === null ? 100 : Number(rawLimit);

  if (!serverParam || serverParam.length > 100 || !isValidServerName(serverParam)) {
    return NextResponse.json({ error: 'Invalid server' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  if (!itemParam || itemParam.length > MAX_ITEM_ID_LENGTH || /[\x00-\x1F\x7F]/.test(itemParam)) {
    return NextResponse.json({ error: 'Invalid item id' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return NextResponse.json({ error: 'Invalid limit' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  // Canonicalizing the server through the live registry is an optimization,
  // not a data requirement: the param was already format-validated above, and
  // price history has nothing to do with registry availability. A transient
  // registry failure must NOT blank out charts (this used to surface as
  // "Server registry unavailable" right under the graph), so fall back to
  // the raw param and let the upstream query decide.
  let canonicalServer = serverParam;
  let registryKnown = false;
  try {
    const servers = await fetchServers();
    const requestedKey = serverIdentityKey(serverParam);
    const match = servers.find((entry) => serverIdentityKey(entry.name) === requestedKey);
    if (match) {
      canonicalServer = match.name;
      registryKnown = true;
    }
  } catch {
    console.warn(`[history] registry unavailable; serving "${serverParam}" without canonicalization`);
  }
  if (registryKnown && !canonicalServer) {
    return NextResponse.json(
      { error: 'Server is not registered' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const upstreamUrl = `${API_URL}/api/history?server=${encodeURIComponent(canonicalServer)}&item=${encodeURIComponent(itemParam)}&limit=${limit}`;

  try {
    const response = await fetch(upstreamUrl, {
      next: {
        revalidate: 15,
        tags: [marketTag(canonicalServer)],
      },
      signal: controller.signal,
    });

    const contentType = response.headers.get('content-type') || '';
    if (!response.ok) {
      return NextResponse.json(
        { error: response.status >= 500 ? 'History service unavailable' : `History request failed (${response.status})` },
        { status: response.status >= 500 ? 503 : response.status, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (!contentType.toLowerCase().includes('application/json')) {
      return NextResponse.json(
        { error: 'History service returned a non-JSON response' },
        { status: 502, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const body: unknown = await response.json();
    if (!Array.isArray(body)) {
      return NextResponse.json(
        { error: 'History service returned an invalid response shape' },
        { status: 502, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    return NextResponse.json(body, {
      status: 200,
      headers: {
        'Cache-Control': 'public, max-age=15, stale-while-revalidate=30',
        'X-Content-Type-Options': 'nosniff',
        Vary: 'Accept-Encoding',
      },
    });
  } catch (error) {
    const message = error instanceof DOMException && error.name === 'AbortError'
      ? 'History request timed out'
      : 'History service unavailable';
    return NextResponse.json({ error: message }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  } finally {
    clearTimeout(timeout);
  }
}
