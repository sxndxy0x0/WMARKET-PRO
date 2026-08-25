/**
 * Tiny in-memory TTL cache shared by services that read from Firestore.
 *
 * Why this exists: several endpoints (/api/prices, /api/stats,
 * /api/stats/timeseries) are polled by the frontend every few seconds, and
 * some of them (stats, timeseries) both independently re-fetch the same
 * 7-day history collection on every single call. On Firestore's free Spark
 * plan (50K reads/day) that burns through quota in minutes once more than
 * one client is polling. This cache sits in front of the expensive reads.
 *
 * Design notes:
 *  - Per-key TTL, not global — different data changes at different rates.
 *  - `getOrLoad` also de-dupes *concurrent* misses for the same key (e.g.
 *    getSummary and getTimeseries both asking for the same server's history
 *    in the same tick): the second caller awaits the first's in-flight
 *    Firestore call instead of starting a duplicate one.
 *  - `invalidate(prefix)` lets writers (priceService.applyPriceUpdate) drop
 *    stale entries immediately instead of waiting out the TTL, so a price
 *    update is visible right away rather than up to TTL_MS late.
 *  - Deliberately NOT a dependency (node-cache, lru-cache, redis, ...):
 *    the access pattern here is simple enough that pulling in a package
 *    (or a whole Redis instance) would be more moving parts than value.
 *    If this backend ever runs as multiple instances behind a load
 *    balancer, replace this with a shared cache (Redis) — right now each
 *    instance would just cache independently, which is still correct, just
 *    less effective.
 */

const store = new Map(); // key -> { data, expiresAt }
const inFlight = new Map(); // key -> Promise (de-dupes concurrent misses)
const generations = new Map(); // key -> invalidation generation
const MAX_CACHE_ENTRIES = 1_024;
const MAX_GENERATION_ENTRIES = 4_096;
const MAX_IN_FLIGHT_ENTRIES = 2_048;

function get(key) {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  return hit.data;
}

function set(key, data, ttlMs) {
  const now = Date.now();
  store.set(key, { data, expiresAt: now + ttlMs });
  if (store.size > MAX_CACHE_ENTRIES) {
    for (const [cacheKey, entry] of store) {
      if (entry.expiresAt <= now) store.delete(cacheKey);
      if (store.size <= MAX_CACHE_ENTRIES) break;
    }
    // If an attacker filled the cache with still-live unique keys, evict the
    // oldest insertion until the hard cap is restored. Map iteration order is
    // insertion order, which gives us a deterministic low-cost bound without
    // another dependency or a full LRU implementation.
    while (store.size > MAX_CACHE_ENTRIES) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) break;
      store.delete(oldest);
    }
  }
}

function pruneGenerations() {
  if (generations.size <= MAX_GENERATION_ENTRIES) return;
  for (const key of generations.keys()) {
    if (generations.size <= MAX_GENERATION_ENTRIES) break;
    if (!store.has(key) && !inFlight.has(key)) generations.delete(key);
  }
}

/**
 * Drop expired entries without waiting for a size-cap eviction or an unlucky
 * `get`. Called periodically from server.js so memory tracks live data even
 * during quiet periods (e.g. overnight, when nothing triggers set()-based
 * pruning but stale entries from the day's traffic still sit in the Map).
 */
function pruneExpired() {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
  pruneGenerations();
}

function invalidateKey(key) {
  generations.set(key, (generations.get(key) || 0) + 1);
  store.delete(key);
  // Do not cancel the promise: callers awaiting the in-flight read still need
  // its result. The generation check prevents that stale result from being
  // cached after the invalidation.
  pruneGenerations();
}

function deleteKey(key) {
  invalidateKey(key);
}

/** Delete every cached entry whose key starts with `prefix`, including in-flight loads. */
function invalidatePrefix(prefix) {
  const keys = new Set();
  for (const key of store.keys()) if (key.startsWith(prefix)) keys.add(key);
  for (const key of inFlight.keys()) if (key.startsWith(prefix)) keys.add(key);
  for (const key of keys) invalidateKey(key);
}

/**
 * Return the cached value for `key`, or call `loader()` to populate it.
 * Concurrent calls for the same (currently uncached) key share one loader
 * call instead of each triggering their own Firestore read.
 */
async function getOrLoad(key, ttlMs, loader) {
  const cached = get(key);
  if (cached !== undefined) return cached;

  if (inFlight.has(key)) return inFlight.get(key);
  if (inFlight.size >= MAX_IN_FLIGHT_ENTRIES) {
    const error = new Error('Cache is temporarily busy; please retry');
    error.status = 503;
    throw error;
  }

  const generation = generations.get(key) || 0;
  const promise = (async () => {
    try {
      const data = await loader();
      // A writer may invalidate this key while the Firestore read is still
      // in flight. Never repopulate the cache with that stale pre-write data.
      if ((generations.get(key) || 0) === generation && inFlight.get(key) === promise) {
        set(key, data, ttlMs);
      }
      return data;
    } finally {
      if (inFlight.get(key) === promise) inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
}

module.exports = { get, set, deleteKey, invalidateKey, invalidatePrefix, getOrLoad, pruneExpired };
