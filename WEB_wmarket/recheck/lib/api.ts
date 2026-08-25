import { dedupeBy, sanitizeItemName } from '@/lib/items';

export type PriceItem = {
  id: string;
  name: string;
  buy: number; // -1 = not applicable (this server has no separate buy price)
  sell: number;
  /** Highest `sell` ever recorded for this item on this server (running
   * max, tracked server-side since it started being recorded — not a
   * true "all-time" high for items that existed before this field was
   * added, since there's no history to backfill from). -1 if unavailable. */
  sellHigh: number;
  stackPrice: number; // -1 if not sent
  updated_at: number;
  /** Optional backend-provided 24H change. When present, this applies to every item. */
  changePct?: number;
};

/**
 * Display name as sent by the shop plugin — may contain legacy formatting
 * codes (`§r`) and resource-pack private-use glyphs that render as tofu.
 * Every parser below runs names through this before the value crosses into
 * components, so no UI code ever sees the raw form.
 */
function cleanName(rawName: string): string {
  const cleaned = sanitizeItemName(rawName);
  // A name made entirely of formatting codes/glyphs would fail the parser's
  // non-empty check downstream; fall back to a trimmed raw value so valid
  // rows are not dropped outright.
  return cleaned || rawName.trim();
}

export type HistoryPoint = {
  id: string;
  name: string;
  buy: number;
  sell: number;
  stackPrice: number;
  created_at: number;
};

export type User = {
  id: string; // Firebase Auth uid
  email: string | null;
  name: string | null;
  picture: string | null;
};

export type WatchlistItem = PriceItem & { server: string; watchedAt: number };

export type GainerItem = {
  id: string;
  name: string;
  currentSell: number;
  pastSell: number;
  changePct: number;
};

export type RecentUpdate = {
  id: string;
  name: string;
  sell: number;
  created_at: number;
};

export type StatsSummary = {
  totalItems: number;
  newToday: number;
  avgChangePct: number | null;
  gainers: GainerItem[];
  recentUpdates: RecentUpdate[];
  volume24h: null; // not tracked by the mod — see backend README
};

export type ServerInfo = {
  name: string;
};

// Server names come from the backend registry and become URL path segments.
// Keep one canonical validation rule everywhere so malformed registry data
// cannot create ambiguous routes/cache tags.
const SERVER_NAME_RE = /^(?=.{1,100}$)[^\x00-\x1F\x7F\\/?#]+$/u;

export function canonicalServerName(name: string): string {
  return name.trim().normalize('NFC');
}

export function serverIdentityKey(name: string): string {
  return serverSlug(name);
}

/**
 * Pretty-URL slug (v19): "MineDream:25565" → "minedream". Thai letters are
 * kept so Thai server names stay readable in the address bar. Routing emits
 * this; resolution compares through the same function, and legacy full-name
 * URLs still resolve because both sides funnel through the same transform.
 */
export function serverSlug(name: string): string {
  const base = shortServerLabel(name)
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9\u0E00-\u0E4F]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return base || 'srv';
}

/** Stable composite key for per-server item state. JSON encoding avoids delimiter
 * collisions because both Minecraft server names and namespaced item IDs may
 * legitimately contain ':'. Deliberately NOT slug-based: persisted watchlists
 * must survive slug-scheme changes, so this keeps the full-name identity. */
export function serverItemIdentityKey(server: string, itemId: string): string {
  return JSON.stringify([canonicalServerName(server).toLocaleLowerCase('en-US'), itemId]);
}

export function isValidServerName(name: string): boolean {
  const value = canonicalServerName(name);
  if (!value || value === '.' || value === '..') return false;
  // Unicode format/control characters (for example zero-width spaces and
  // bidi controls) are not meaningful in a Minecraft server identity and
  // can make two visually identical names become different partitions.
  if (/[\p{Cc}\p{Cf}]/u.test(value)) return false;
  return SERVER_NAME_RE.test(value);
}

export function decodeServerSegment(value: string): string {
  // Verified against Next 16.3: dynamic-route params arrive STILL
  // PERCENT-ENCODED (`/play.x%3A25565` → params.server ===
  // "play.x%3A25565"), contrary to older App Router behavior this file's
  // previous comment assumed — every server name containing ":" failed
  // registry resolution because of that single mismatch. Decode exactly
  // once; a malformed sequence (e.g. a bare trailing "%") keeps the raw
  // input instead of throwing.
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export type PriceAlert = {
  id: string; // Firestore doc id
  server: string;
  itemId: string;
  itemName: string;
  thresholdType: 'above' | 'below';
  thresholdValue: number;
  createdAt: number;
  triggeredAt: number | null;
};

const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim() || '';

export function normalizeApiUrl(value: string): string {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return '';
    if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') return '';
    url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

const API_URL = normalizeApiUrl(configuredApiUrl) || (process.env.NODE_ENV === 'development' && !configuredApiUrl ? 'http://localhost:3000' : '');
const REQUEST_TIMEOUT_MS = 15_000;
let clientServerCache: { expiresAt: number; value: ServerInfo[] } | null = null;
let clientServerRequest: Promise<ServerInfo[]> | null = null;

// Auth is Google Sign-In via Firebase — there's no long-lived token to
// manage by hand here. Firebase's SDK persists the signed-in session
// itself (IndexedDB) and this just asks it for a current, valid ID token
// on demand; it transparently refreshes the token behind the scenes if the
// cached one is close to expiring, so callers never deal with a stale
// token or manual refresh logic. Returns null if nobody's signed in.
async function getIdToken(): Promise<string | null> {
  const { getFirebaseAuth } = await import('./firebase');
  const auth = getFirebaseAuth();
  return auth.currentUser ? auth.currentUser.getIdToken() : null;
}

async function request<T>(
  path: string,
  options: RequestInit & { auth?: boolean; revalidate?: number; tags?: string[] } = {}
): Promise<T> {
  const { auth, headers, revalidate, tags, ...rest } = options;
  const finalHeaders: Record<string, string> = {
    ...(headers as Record<string, string> | undefined),
  };
  if (rest.body !== undefined && !Object.keys(finalHeaders).some((key) => key.toLowerCase() === 'content-type')) {
    finalHeaders['Content-Type'] = 'application/json';
  }

  if (auth) {
    const token = await getIdToken();
    if (!token) throw new Error('Not signed in');
    finalHeaders.Authorization = `Bearer ${token}`;
  }

  // `revalidate` (seconds) puts this fetch in Next.js's Data Cache, shared
  // across ALL visitors hitting this route — not per-visitor. That's what
  // actually stops the read-quota problem: without it (the old
  // `cache: 'no-store'` on every call), every single page load/refresh/nav,
  // by anyone, was an uncached round trip to the backend, regardless of
  // whether the underlying price data had changed. Auth/mutation calls
  // (no `revalidate` passed) keep the old no-store behavior — those must
  // always be fresh.
  //
  // `tags` lets app/api/revalidate/route.ts purge this exact cache entry
  // on demand (via revalidateTag) the moment a real sync happens — WITHOUT
  // this, calling router.refresh() from LiveRefresh.tsx would just
  // re-render with the SAME cached data until the `revalidate` window
  // naturally expired, silently defeating the whole point of the
  // WebSocket push (router.refresh() re-runs the fetch call, but Next's
  // Data Cache would still serve the stale cached response for up to
  // `revalidate` seconds — it doesn't bypass the cache by itself).
  const cacheOptions: RequestInit & { next?: { revalidate?: number; tags?: string[] } } =
    revalidate !== undefined ? { next: { revalidate, tags } } : { cache: 'no-store' as RequestCache };

  if (!API_URL) {
    throw new Error('ยังไม่ได้ตั้งค่า NEXT_PUBLIC_API_URL สำหรับ Production');
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const callerSignal = rest.signal;
  const abortFromCaller = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', abortFromCaller, { once: true });
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...rest,
      headers: finalHeaders,
      ...cacheOptions,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      if (timedOut) throw new Error(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
      throw error;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener('abort', abortFromCaller);
  }

  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // response wasn't JSON — keep the status text
    }
    throw new Error(message);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

// Public price/stat data changes only when the in-game mod syncs — far less
// often than pages get loaded. 15s matches the backend's own cache TTL
// (services/priceService.js, statsService.js) as a safety-net upper bound.
// Real near-instant updates come from the on-demand revalidateTag() call in
// app/api/revalidate/route.ts, triggered by the WebSocket listener in
// components/LiveRefresh.tsx — mounted by the server layout; see the `tags` note above for why both
// pieces (tag AND revalidate route) are needed, not just router.refresh().
// Safety window for the shared Data Cache. Real-time freshness comes from
// the WebSocket -> /api/revalidate path which purges these tags the moment a
// sync lands, so this window only bounds worst-case staleness when that
// push fails — 30s halves background Firestore reads at zero UX cost.
const PUBLIC_DATA_REVALIDATE_SECONDS = 30;

/** Shared cache tag for all of one server's price/stat data. */
export function marketTag(server: string): string {
  const canonical = assertServerName(server);
  return `market:${encodeURIComponent(serverIdentityKey(canonical))}`;
}

export function serverPath(server: string, path = ''): string {
  const canonical = assertServerName(server);
  // v19 pretty URLs: emit the slug form ("/minedream/item/…") instead of
  // percent-encoded full names with ports.
  const encoded = encodeURIComponent(serverSlug(canonical));
  const suffix = path ? (path.startsWith('/') ? path : `/${path}`) : '';
  return `/${encoded}${suffix}`;
}

/**
 * Display label for a server name: mods register "Name:Port" style ids, but
 * the port is noise in the UI. Routing still uses the FULL canonical name
 * (serverPath); only what humans read gets trimmed.
 */
export function shortServerLabel(name: string): string {
  const trimmed = name.trim();
  const withoutPort = trimmed.replace(/[:\s]+(?:\d{2,5})\s*$/, '');
  return withoutPort || trimmed;
}

// --- Servers (public) ----------------------------------------------------

export async function fetchServers(): Promise<ServerInfo[]> {
  let raw: unknown;
  if (typeof window !== 'undefined') {
    const now = Date.now();
    // Seed from localStorage first: the registry changes ~never, so even a
    // cold tab should be able to open the server switcher instantly instead
    // of waiting on the network round-trip.
    if (!clientServerCache) {
      try {
        const seeded = JSON.parse(localStorage.getItem('wm-servers') || 'null') as
          | { t: number; v: ServerInfo[] }
          | null;
        if (seeded?.v && Date.now() - seeded.t < 86_400_000) {
          clientServerCache = { value: seeded.v, expiresAt: now + 60_000 };
        }
      } catch {
        /* corrupted seed — ignore, fall through to network */
      }
    }
    if (clientServerCache && clientServerCache.expiresAt > now) return clientServerCache.value;
    if (clientServerRequest) return clientServerRequest;
    clientServerRequest = fetch('/api/servers', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.toLowerCase().includes('application/json')) {
          throw new Error('Server registry returned a non-JSON response');
        }
        return res.json();
      })
      .finally(() => {
        clientServerRequest = null;
      });
    raw = await clientServerRequest;
  } else {
    raw = await request<unknown>('/api/servers', {
      revalidate: 15,
      tags: ['servers'],
    });
  }

  const values = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { servers?: unknown }).servers)
      ? (raw as { servers: unknown[] }).servers
      : null;

  // A malformed registry must be treated as an upstream failure, not as an
  // empty registry. Returning [] here makes the UI report "ยังไม่พบเซิร์ฟเวอร์"
  // and can also make a valid server temporarily look unregistered. The
  // /api/servers route already validates its response shape; keep the same
  // contract for direct server-side callers of fetchServers().
  if (!values) throw new Error('Backend returned an invalid server registry');

  const names = values
    .map((value) => {
      if (typeof value === 'string') return canonicalServerName(value);
      if (value && typeof value === 'object' && typeof (value as { name?: unknown }).name === 'string') {
        return (value as { name: string }).name.trim();
      }
      return '';
    })
    .filter((name): name is string => isValidServerName(name));

  const result = Array.from(new Set(names.map(serverIdentityKey)))
    .map((key) => {
      const original = names.find((name) => serverIdentityKey(name) === key) as string;
      return { name: canonicalServerName(original) };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  // 60s client cache: the server list changes ~never, and every page's
  // Topbar asks for it on mount — 15s meant most navigations re-fetched.
  if (typeof window !== 'undefined') {
    clientServerCache = { value: result, expiresAt: Date.now() + 60_000 };
    try {
      localStorage.setItem('wm-servers', JSON.stringify({ t: Date.now(), v: result }));
    } catch {
      /* storage full/blocked — memory cache still applies */
    }
  }
  return result;
}

export async function resolveServerName(server: string): Promise<string | null> {
  const wanted = server.trim();
  if (!isValidServerName(wanted)) return null;
  const servers = await fetchServers();
  return servers.find((entry) => serverIdentityKey(entry.name) === serverIdentityKey(wanted))?.name ?? null;
}

// --- Prices / stats (public) ---------------------------------------------
// Runtime validation keeps malformed backend responses from crossing the
// server/client boundary as falsely-typed data. The API layer is deliberately
// dependency-free so these guards work in both Server Components and the browser.
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parsePriceItem(value: unknown): PriceItem | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== 'string' || !item.id.trim() || item.id.length > 200 || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 200) return null;
  if (!isFiniteNumber(item.buy) || !isFiniteNumber(item.sell) || !isFiniteNumber(item.sellHigh) ||
      !isFiniteNumber(item.stackPrice) || !isFiniteNumber(item.updated_at)) return null;
  if (item.changePct !== undefined && !isFiniteNumber(item.changePct)) return null;
  const changePct = item.changePct as number | undefined;
  return {
    id: item.id,
    name: cleanName(item.name),
    buy: item.buy,
    sell: item.sell,
    sellHigh: item.sellHigh,
    stackPrice: item.stackPrice,
    updated_at: item.updated_at,
    ...(changePct === undefined ? {} : { changePct }),
  };
}

function parseHistoryPoint(value: unknown): HistoryPoint | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== 'string' || !item.id.trim() || item.id.length > 200 || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 200) return null;
  if (!isFiniteNumber(item.buy) || !isFiniteNumber(item.sell) || !isFiniteNumber(item.stackPrice) || !isFiniteNumber(item.created_at)) return null;
  return { id: item.id, name: cleanName(item.name), buy: item.buy, sell: item.sell, stackPrice: item.stackPrice, created_at: item.created_at };
}

function parseStatsSummary(value: unknown): StatsSummary | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (!Number.isInteger(item.totalItems) || !Number.isInteger(item.newToday) ||
      !(item.avgChangePct === null || isFiniteNumber(item.avgChangePct)) ||
      !Array.isArray(item.gainers) || !Array.isArray(item.recentUpdates)) return null;
  const totalItems = item.totalItems as number;
  const newToday = item.newToday as number;
  if (totalItems < 0 || newToday < 0) return null;
  const gainers: GainerItem[] = [];
  for (const raw of item.gainers) {
    if (!raw || typeof raw !== 'object') return null;
    const g = raw as Record<string, unknown>;
    if (typeof g.id !== 'string' || !g.id.trim() || g.id.length > 200 || typeof g.name !== 'string' || !g.name.trim() || g.name.length > 200 || !isFiniteNumber(g.currentSell) || !isFiniteNumber(g.pastSell) || !isFiniteNumber(g.changePct)) return null;
    gainers.push({ id: g.id, name: cleanName(g.name), currentSell: g.currentSell, pastSell: g.pastSell, changePct: g.changePct });
  }
  const recentUpdates: RecentUpdate[] = [];
  for (const raw of item.recentUpdates) {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== 'string' || !r.id.trim() || r.id.length > 200 || typeof r.name !== 'string' || !r.name.trim() || r.name.length > 200 || !isFiniteNumber(r.sell) || !isFiniteNumber(r.created_at)) return null;
    recentUpdates.push({ id: r.id, name: cleanName(r.name), sell: r.sell, created_at: r.created_at });
  }
  const avgChangePct = item.avgChangePct as number | null;
  return { totalItems, newToday, avgChangePct, gainers, recentUpdates, volume24h: null };
}

function parseUser(value: unknown): User | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== 'string' || !item.id.trim() || item.id.length > 200) return null;
  if (item.email !== null && (typeof item.email !== 'string' || item.email.length > 320)) return null;
  if (item.name !== null && (typeof item.name !== 'string' || item.name.length > 200)) return null;
  if (item.picture !== null && (typeof item.picture !== 'string' || item.picture.length > 2048)) return null;
  return { id: item.id, email: item.email as string | null, name: item.name as string | null, picture: item.picture as string | null };
}

function parseWatchlistItem(value: unknown): WatchlistItem | null {
  if (!value || typeof value !== 'object') return null;
  const item = parsePriceItem(value);
  const raw = value as Record<string, unknown>;
  if (!item || typeof raw.server !== 'string' || !isValidServerName(raw.server) || !isFiniteNumber(raw.watchedAt)) return null;
  return { ...item, server: canonicalServerName(raw.server), watchedAt: raw.watchedAt };
}

function parsePriceAlert(value: unknown): PriceAlert | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== 'string' || !item.id.trim() || item.id.length > 200 || typeof item.server !== 'string' || !isValidServerName(item.server) ||
      typeof item.itemId !== 'string' || !item.itemId.trim() || item.itemId.length > 200 ||
      typeof item.itemName !== 'string' || !item.itemName.trim() || item.itemName.length > 200 ||
      (item.thresholdType !== 'above' && item.thresholdType !== 'below') ||
      !isFiniteNumber(item.thresholdValue) || !isFiniteNumber(item.createdAt) ||
      (item.triggeredAt !== null && !isFiniteNumber(item.triggeredAt))) return null;
  return {
    id: item.id, server: canonicalServerName(item.server), itemId: item.itemId, itemName: item.itemName,
    thresholdType: item.thresholdType, thresholdValue: item.thresholdValue,
    createdAt: item.createdAt, triggeredAt: item.triggeredAt as number | null,
  };
}

function asArray<T>(value: unknown, parser: (value: unknown) => T | null): T[] {
  if (!Array.isArray(value)) throw new Error('Backend returned an invalid response shape');
  const parsed = value.map(parser);
  if (parsed.some((item) => item === null)) throw new Error('Backend returned invalid data');
  return parsed as T[];
}

/**
 * Collapse history rows that describe the SAME market observation: the
 * plugin's plain-id and `#variant-<hash>` twins both sync, producing two
 * rows with an identical timestamp + prices. On a chart they render as
 * stacked points at the same x and make tooltips flicker between twins.
 * Rows at different times or with different prices stay untouched.
 */
function dedupeHistoryPoints(points: HistoryPoint[]): HistoryPoint[] {
  const seen = new Set<string>();
  const out: HistoryPoint[] = [];
  for (const point of points) {
    const key = `${point.created_at}|${point.buy}|${point.sell}|${point.stackPrice}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(point);
  }
  return out;
}


export async function fetchPrices(server: string): Promise<PriceItem[]> {
  const safeServer = assertServerName(server);
  const raw = await request<unknown>(`/api/prices?server=${encodeURIComponent(safeServer)}`, {
    revalidate: PUBLIC_DATA_REVALIDATE_SECONDS,
    tags: [marketTag(safeServer)],
  });
  const items = asArray(raw, parsePriceItem);
  // Shop plugins register the same listing twice (a plain id and a
  // `#variant-<hash>` twin, both with identical prices). Collapse them here
  // so every table/grid consumer sees one row per real item.
  return dedupeBy(items, (kept, dropped) => ({
    sellHigh: Math.max(kept.sellHigh, dropped.sellHigh),
    updated_at: Math.max(kept.updated_at, dropped.updated_at),
  }));
}

export async function fetchHistory(server: string, itemId: string, limit = 100): Promise<HistoryPoint[]> {
  const safeServer = assertServerName(server);
  const safeItemId = assertItemId(itemId);
  const safeLimit = Number.isInteger(limit) ? Math.min(500, Math.max(1, limit)) : 100;
  const path = `/api/history?server=${encodeURIComponent(safeServer)}&item=${encodeURIComponent(safeItemId)}&limit=${safeLimit}`;

  // Client components cannot use Next's server-side Data Cache when they call
  // the backend URL directly. Use the same-origin proxy so side-panel/history
  // reads share the same 15s cached backend request as server-rendered pages.
  if (typeof window !== 'undefined') {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) {
      let message = `${response.status} ${response.statusText}`;
      try {
        const body = await response.json();
        if (body?.error) message = body.error;
      } catch {
        // Keep the HTTP status when the proxy returned a non-JSON error.
      }
      throw new Error(message);
    }
    return dedupeHistoryPoints(asArray(await response.json(), parseHistoryPoint));
  }

  const raw = await request<unknown>(path, {
    revalidate: PUBLIC_DATA_REVALIDATE_SECONDS,
    tags: [marketTag(safeServer)],
  });
  return dedupeHistoryPoints(asArray(raw, parseHistoryPoint));
}

export async function fetchStats(server: string): Promise<StatsSummary> {
  const safeServer = assertServerName(server);
  const raw = await request<unknown>(`/api/stats?server=${encodeURIComponent(safeServer)}`, {
    revalidate: PUBLIC_DATA_REVALIDATE_SECONDS,
    tags: [marketTag(safeServer)],
  });
  const parsed = parseStatsSummary(raw);
  if (!parsed) throw new Error('Backend returned invalid stats data');
  return parsed;
}

// --- Auth ----------------------------------------------------------------
// Sign-in itself happens client-side via Firebase (signInWithPopup with
// GoogleAuthProvider — see lib/auth-context.tsx), not through this backend
// API at all: the backend never sees a password, only ever a Firebase ID
// token proving an already-completed Google sign-in. `fetchMe` is just
// this app's own profile lookup once that token exists.

export async function fetchMe(): Promise<{ user: User }> {
  const raw = await request<unknown>('/api/auth/me', { auth: true });
  if (!raw || typeof raw !== 'object') throw new Error('Backend returned invalid user data');
  const value = (raw as { user?: unknown }).user;
  const user = parseUser(value);
  if (!user) throw new Error('Backend returned invalid user data');
  return { user };
}

// --- Watchlist (auth required) -----------------------------------------

export async function fetchWatchlist(): Promise<WatchlistItem[]> {
  const raw = await request<unknown>('/api/watchlist', { auth: true });
  return asArray(raw, parseWatchlistItem);
}

function assertServerName(server: string): string {
  const canonical = canonicalServerName(server);
  if (!isValidServerName(canonical)) throw new Error('Invalid server name');
  return canonical;
}

function assertItemId(itemId: string): string {
  const value = typeof itemId === 'string' ? itemId.trim() : '';
  if (!value || value.length > 200 || /[\x00-\x1F\x7F]/.test(value)) {
    throw new Error('Invalid item id');
  }
  return value;
}

export function addToWatchlist(server: string, itemId: string): Promise<void> {
  const safeServer = assertServerName(server);
  const safeItemId = assertItemId(itemId);
  return request('/api/watchlist', {
    method: 'POST',
    auth: true,
    body: JSON.stringify({ server: safeServer, itemId: safeItemId }),
  });
}

export function removeFromWatchlist(server: string, itemId: string): Promise<void> {
  const safeServer = assertServerName(server);
  const safeItemId = assertItemId(itemId);
  return request(`/api/watchlist/${encodeURIComponent(safeServer)}/${encodeURIComponent(safeItemId)}`, {
    method: 'DELETE',
    auth: true,
  });
}

// --- Price alerts (auth required) --------------------------------------

export async function fetchAlerts(): Promise<PriceAlert[]> {
  const raw = await request<unknown>('/api/alerts', { auth: true });
  return asArray(raw, parsePriceAlert);
}

export function createAlert(input: {
  server: string;
  itemId: string;
  itemName: string;
  thresholdType: 'above' | 'below';
  thresholdValue: number;
}): Promise<void> {
  const server = assertServerName(input.server);
  const itemId = assertItemId(input.itemId);
  const itemName = input.itemName.trim();
  if (!itemName || itemName.length > 200 || /[\x00-\x1F\x7F]/.test(itemName)) throw new Error('Invalid item name');
  if (
    (input.thresholdType !== 'above' && input.thresholdType !== 'below') ||
    !Number.isFinite(input.thresholdValue) ||
    input.thresholdValue < 0
  ) {
    throw new Error('Invalid alert threshold');
  }
  return request('/api/alerts', {
    method: 'POST',
    auth: true,
    body: JSON.stringify({ server, itemId, itemName, thresholdType: input.thresholdType, thresholdValue: input.thresholdValue }),
  });
}

export function deleteAlert(id: string): Promise<void> {
  if (typeof id !== 'string' || !id.trim() || id.length > 200 || /[\x00-\x1F\x7F]/.test(id)) throw new Error('Invalid alert id');
  return request(`/api/alerts/${encodeURIComponent(id)}`, { method: 'DELETE', auth: true });
}

/** Derives the ws:// or wss:// URL from NEXT_PUBLIC_API_URL. */
export function getWebSocketUrl(): string {
  if (!API_URL) throw new Error('ยังไม่ได้ตั้งค่า NEXT_PUBLIC_API_URL สำหรับ Production');
  const url = new URL(API_URL);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  // Preserve an optional deployment base path. `request()` concatenates
  // API paths onto NEXT_PUBLIC_API_URL, so WebSocket must do the same.
  // Otherwise an API hosted at `https://example.com/price-sync` would use
  // `/ws` instead of `/price-sync/ws` and the live-refresh connection would
  // fail only in that deployment shape.
  const basePath = url.pathname.replace(/\/+$/, '');
  url.pathname = `${basePath}/ws` || '/ws';
  url.search = '';
  url.hash = '';
  return url.toString();
}
