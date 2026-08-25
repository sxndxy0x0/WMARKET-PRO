import { HistoryPoint, serverItemIdentityKey } from './api';

type CacheEntry = { status: 'loading' } | { status: 'ready'; points: HistoryPoint[] } | { status: 'error'; retryAt: number };

const ERROR_RETRY_MS = 30_000;

// A dashboard renders dozens of sparklines at once and every visible one
// calls ensureSparklineLoaded on mount. Without throttling here the browser
// fires that entire burst at /api/history simultaneously, which trips the
// backend's per-IP rate limit (HTTP 429 storms seen in dev logs) and, under
// load, upstream hiccups (503). Serialize through one small semaphore with
// a start-gap so requests leave at a pace the backend tolerates, and retry
// transient failures instead of punishing the chart with a 30s error state.
//
// Pacing math: the backend allows 120 req/min/IP shared by every endpoint.
// A hard ≥700ms gap between starts caps this queue at ~85/min, leaving
// headroom for prices/stats/server-list traffic on the same IP.
const MAX_CONCURRENT_FETCHES = 2;
const START_GAP_MS = 700;
const MAX_ATTEMPTS = 3;

let runningCount = 0;
const slotWaiters: Array<() => void> = [];
let earliestNextStart = 0;

async function acquireSlot(): Promise<void> {
  if (runningCount >= MAX_CONCURRENT_FETCHES) {
    await new Promise<void>((resolve) => slotWaiters.push(resolve));
  }
  runningCount += 1;
  const now = Date.now();
  const waitMs = Math.max(0, earliestNextStart - now);
  earliestNextStart = Math.max(now, earliestNextStart) + START_GAP_MS;
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
}

function releaseSlot(): void {
  runningCount -= 1;
  slotWaiters.shift()?.();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableHistoryError(err: unknown): boolean {
  if (err instanceof TypeError) return true; // network-level fetch failure
  const message = err instanceof Error ? err.message : '';
  return /^(429|500|502|503|504)\b/.test(message);
}

const cache = new Map<string, CacheEntry>();
const listeners = new Map<string, Set<() => void>>();

function notify(key: string) {
  listeners.get(key)?.forEach((fn) => fn());
}

function cacheKey(server: string, itemId: string): string {
  // Keep the sparkline cache partitioned by the same canonical server
  // identity used by the rest of the site, so SIAM/siam cannot create two
  // independent history caches for the same logical server.
  return serverItemIdentityKey(server, itemId);
}

export function getSparklineCacheEntry(itemId: string, server?: string): CacheEntry | undefined {
  if (!server) return cache.get(itemId);
  return cache.get(cacheKey(server, itemId));
}

export function subscribeSparkline(itemId: string, onChange: () => void, server?: string): () => void {
  const key = server ? cacheKey(server, itemId) : itemId;
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key)!.add(onChange);
  return () => {
    const set = listeners.get(key);
    if (!set) return;
    set.delete(onChange);
    if (set.size === 0) listeners.delete(key);
  };
}

export async function ensureSparklineLoaded(itemId: string, server: string, fetchHistory: (server: string, id: string, limit?: number) => Promise<HistoryPoint[]>) {
  const key = cacheKey(server, itemId);
  const existing = cache.get(key);
  if (existing) {
    if (existing.status !== 'error') return;
    if (Date.now() < existing.retryAt) return;
  }
  cache.set(key, { status: 'loading' });
  notify(key);
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    await acquireSlot();
    try {
      const points = await fetchHistory(server, itemId, 96);
      const validPoints = points
        .filter((p) => Number.isFinite(p.created_at) && p.created_at > 0 && Number.isFinite(p.sell) && p.sell >= 0)
        .slice()
        .sort((a, b) => a.created_at - b.created_at);
      cache.set(key, { status: 'ready', points: validPoints });
      notify(key);
      return;
    } catch (err) {
      lastError = err;
    } finally {
      releaseSlot();
    }
    if (!isRetriableHistoryError(lastError) || attempt === MAX_ATTEMPTS - 1) break;
    // Backoff grows per attempt with jitter so a whole page of sparklines
    // does not re-fire in lockstep after a throttle window.
    await sleep(700 * (attempt + 1) + Math.random() * 400);
  }
  cache.set(key, { status: 'error', retryAt: Date.now() + ERROR_RETRY_MS });
  notify(key);
}
