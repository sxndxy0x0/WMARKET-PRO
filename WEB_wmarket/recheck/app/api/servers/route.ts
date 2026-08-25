import { NextResponse } from 'next/server';
import { canonicalServerName, isValidServerName, normalizeApiUrl, serverIdentityKey } from '@/lib/api';



const API_URL = normalizeApiUrl(process.env.NEXT_PUBLIC_API_URL?.trim() || '');
const TIMEOUT_MS = 10_000;

// Tiny in-process cache so the many client components that need the registry
// (home, Topbar switcher, panel links) do not each translate into an upstream
// backend hit. Fresh for 10s; on upstream failure a last-good copy keeps
// serving for another ~110s instead of erroring the whole UI off one blip.
const CACHE_TTL_MS = 10_000;
const STALE_TTL_MS = 120_000;
let cached: { at: number; body: string } | null = null;

export async function GET() {
  if (!API_URL) {
    return NextResponse.json({ error: 'NEXT_PUBLIC_API_URL is not configured' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return new NextResponse(cached.body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=15, stale-while-revalidate=30',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${API_URL}/api/servers`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok) {
      if (cached && Date.now() - cached.at < STALE_TTL_MS) {
        return new NextResponse(cached.body, {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=5, stale-while-revalidate=10', 'X-Content-Type-Options': 'nosniff', 'X-Registry-Cache': 'stale' },
        });
      }
      return NextResponse.json(
        { error: 'Server registry unavailable' },
        { status: response.status >= 500 ? 503 : response.status, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    if (!contentType.toLowerCase().includes('application/json')) {
      return NextResponse.json({ error: 'Server registry returned a non-JSON response' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    }
    const body = await response.json();
    const values = Array.isArray(body)
      ? body
      : body && typeof body === 'object' && Array.isArray((body as { servers?: unknown }).servers)
        ? (body as { servers: unknown[] }).servers
        : null;
    if (!values) {
      return NextResponse.json({ error: 'Server registry returned an invalid shape' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    }
    const names = values
      .map((value) => typeof value === 'string' ? canonicalServerName(value) : value && typeof value === 'object' && typeof (value as { name?: unknown }).name === 'string' ? (value as { name: string }).name.trim() : '')
      .filter((name): name is string => isValidServerName(name));
    const servers = Array.from(new Map(names.map((name) => [serverIdentityKey(name), canonicalServerName(name)])).values())
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      .map((name) => ({ name }));
    const bodyString = JSON.stringify({ servers });
    cached = { at: Date.now(), body: bodyString };
    return new NextResponse(bodyString, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=15, stale-while-revalidate=30',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    // Serve the last-good registry when the upstream blips — a stale server
    // list is strictly better for the UI than an error banner.
    if (cached && Date.now() - cached.at < STALE_TTL_MS) {
      return new NextResponse(cached.body, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=5, stale-while-revalidate=10',
          'X-Content-Type-Options': 'nosniff',
          'X-Registry-Cache': 'stale',
        },
      });
    }
    const message = error instanceof DOMException && error.name === 'AbortError' ? 'Server registry request timed out' : 'Server registry unavailable';
    return NextResponse.json({ error: message }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  } finally {
    clearTimeout(timeout);
  }
}
