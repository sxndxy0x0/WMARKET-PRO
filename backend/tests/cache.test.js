require('./helpers/stubs.js');

const test = require('node:test');
const assert = require('node:assert/strict');

const cache = require('../services/cache');

test('getOrLoad caches within TTL and calls the loader once', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  let loads = 0;
  const key = 't1:basic';

  const first = await cache.getOrLoad(key, 15_000, async () => { loads += 1; return { v: 1 }; });
  const second = await cache.getOrLoad(key, 15_000, async () => { loads += 1; return { v: 2 }; });

  assert.equal(loads, 1);
  assert.deepEqual(first, { v: 1 });
  assert.deepEqual(second, { v: 1 }); // cached value, not a fresh load
});

test('getOrLoad reloads after the TTL expires', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  let loads = 0;
  const key = 't1:ttl';

  await cache.getOrLoad(key, 15_000, async () => { loads += 1; return 'a'; });
  t.mock.timers.tick(15_001); // past expiry
  const value = await cache.getOrLoad(key, 15_000, async () => { loads += 1; return 'b'; });

  assert.equal(loads, 2);
  assert.equal(value, 'b');
});

test('concurrent misses for the same key share one loader call', async () => {
  let loads = 0;
  let releaseLoader;
  const gate = new Promise((resolve) => { releaseLoader = resolve; });
  const key = 't1:dedupe';

  const p1 = cache.getOrLoad(key, 15_000, async () => {
    loads += 1;
    await gate;
    return 'shared';
  });
  const p2 = cache.getOrLoad(key, 15_000, async () => {
    loads += 1;
    return 'should-not-run';
  });

  releaseLoader();
  const [v1, v2] = await Promise.all([p1, p2]);
  assert.equal(loads, 1, 'second caller must await the in-flight load');
  assert.equal(v1, 'shared');
  assert.equal(v2, 'shared');
});

test('invalidating while a load is in flight keeps the stale result out of the cache', async () => {
  let loads = 0;
  let releaseLoader;
  const gate = new Promise((resolve) => { releaseLoader = resolve; });
  const key = 't1:generation';

  const inFlight = cache.getOrLoad(key, 15_000, async () => {
    loads += 1;
    await gate;
    return 'stale-data';
  });

  // A writer lands while the read is still running.
  cache.deleteKey(key);
  releaseLoader();
  const awaited = await inFlight;

  assert.equal(awaited, 'stale-data', 'the in-flight caller still gets its result');
  assert.equal(cache.get(key), undefined, 'but it must not be cached post-invalidation');
  const next = await cache.getOrLoad(key, 15_000, async () => { loads += 1; return 'fresh'; });
  assert.equal(next, 'fresh');
  assert.equal(loads, 2);
});

test('invalidatePrefix drops every matching key only', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  await cache.getOrLoad('prefix:a:1', 15_000, async () => 'x');
  await cache.getOrLoad('prefix:a:2', 15_000, async () => 'y');
  await cache.getOrLoad('other:b', 15_000, async () => 'z');

  cache.invalidatePrefix('prefix:a:');

  assert.equal(cache.get('prefix:a:1'), undefined);
  assert.equal(cache.get('prefix:a:2'), undefined);
  assert.equal(cache.get('other:b'), 'z');
});

test('pruneExpired removes only expired entries', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  await cache.getOrLoad('sweep:old', 1_000, async () => 'o');
  await cache.getOrLoad('sweep:new', 60_000, async () => 'n');

  t.mock.timers.tick(2_000); // old expired, new still live
  cache.pruneExpired();

  assert.equal(cache.get('sweep:old'), undefined);
  assert.equal(cache.get('sweep:new'), 'n');
});
