/**
 * Behavior tests for the quota-saving write-dedup in applyPriceUpdate.
 *
 * Uses a STATEFUL fake Firestore (real get/set semantics over in-memory maps)
 * injected through the same require.cache stub mechanism as helpers/stubs.js,
 * then drives applyPriceUpdate twice with identical payloads and asserts the
 * second sync performs ZERO writes, while a real price change writes exactly
 * one current doc + one history doc and keeps sellPriceHigh monotonic.
 */
require('./helpers/stubs.js');

const test = require('node:test');
const assert = require('node:assert');

// --- stateful fake firestore ------------------------------------------------
const collections = { prices: new Map(), priceHistory: new Map() };
const counters = { txSets: 0, txGets: 0, batchSets: 0, getAllCalls: 0, histScans: 0, alertScans: 0 };

function makeCol(name) {
  const m = collections[name] ?? (collections[name] = new Map());
  return {
    doc(id) {
      return {
        id,
        __col: name, // lets batch.set route to the right collection
        async get() {
          const d = m.get(id);
          return d ? { exists: true, id, data: () => ({ ...d }) } : { exists: false, id, data: () => ({}) };
        },
        set(data) { m.set(id, { ...data }); },
        update(data) { m.set(id, { ...(m.get(id) || {}), ...data }); },
      };
    },
    where() { return this; },
    orderBy() { return this; },
    limit() { return this; },
    async get() {
      if (name === 'priceHistory') counters.histScans += 1;
      if (name === 'priceAlerts') counters.alertScans += 1;
      const docs = [...m.entries()].map(([id, d]) => ({ exists: true, id, data: () => ({ ...d }) }));
      return { empty: docs.length === 0, size: docs.length, docs };
    },
  };
}

const richDb = {
  collection: (name) => makeCol(name),
  async getAll(...refs) {
    counters.getAllCalls += 1;
    // Legacy refs point at the prices collection by naming convention.
    return refs.map((ref) => {
      const d = collections.prices.get(ref.id);
      return d ? { exists: true, id: ref.id, data: () => ({ ...d }) } : { exists: false, id: ref.id, data: () => ({}) };
    });
  },
  async runTransaction(fn) {
    return fn({
      async get(ref) {
        counters.txGets += 1;
        const d = collections.prices.get(ref.id);
        return d ? { exists: true, id: ref.id, data: () => ({ ...d }) } : { exists: false, id: ref.id, data: () => ({}) };
      },
      set(ref, data) { counters.txSets += 1; collections.prices.set(ref.id, { ...data }); },
      update() {}, create() {}, delete() {},
    });
  },
  batch() {
    return {
      set(ref, data) {
        counters.batchSets += 1;
        const target = collections[ref.__col] ?? collections.prices;
        target.set(ref.id, { ...data });
      },
      async commit() {},
    };
  },
};

// Swap the base stub's no-op db for the stateful one BEFORE loading services.
require.cache[require.resolve('../database/firestore')].exports.db = richDb;

// Stub serverQueries too so price reads hit our maps deterministically.
const Module = require('node:module');
const sqPath = require.resolve('../services/serverQueries');
const sqStub = new Module(sqPath, null);
sqStub.filename = sqPath;
sqStub.loaded = true;
sqStub.exports = {
  // Honors orderBy/limit chains like real Firestore so newest-first loaders
  // behave identically under test.
  async queryByServer(colRef, server, modifier) {
    const state = { orders: [], limitVal: null };
    const q = {
      where() { return this; },
      orderBy(field, dir) { state.orders.push({ field, dir: dir || 'asc' }); return this; },
      limit(n) { state.limitVal = n; return this; },
      async get() { return colRef.get(); },
    };
    const snap = await modifier(q).get();
    let docs = snap.docs.filter((d) => d.data().server === server);
    for (const o of state.orders) {
      docs = [...docs].sort((A, B) => {
        const av = A.data()[o.field] ?? 0;
        const bv = B.data()[o.field] ?? 0;
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return o.dir === 'desc' ? -cmp : cmp;
      });
    }
    if (state.limitVal != null) docs = docs.slice(0, state.limitVal);
    return docs; // queryByServer's contract: a plain array of docs
  },
};
require.cache[sqPath] = sqStub;

const priceService = require('../services/priceService');
const statsService = require('../services/statsService');

const SERVER = 'Demo';
// Real-ish clock: the API only accepts timestamps within 7 days in the past.
const BASE = Math.floor(Date.now() / 1000) - 6 * 24 * 3600;
const payloadAt = (offsetSeconds, overrides = {}) => ({
  server: SERVER,
  timestamp: BASE + offsetSeconds,
  // Mirrors real mod payloads: stackPrice is OMITTED (not null) when n/a.
  // `overrides` targets item "b" so change-tests can mutate one item.
  prices: [
    { id: 'a', name: 'Apple', buy: 1, sell: 10 },
    { id: 'b', name: 'Banana', buy: 2, sell: 20, ...overrides },
    { id: 'c', name: 'Berry', buy: -1, sell: -1, stackPrice: 64 },
  ],
});

test('first sync writes everything; identical resync writes NOTHING; change writes exactly one pair', async () => {
  // Seed a legacy alias carrying an older firstSeen + higher historical high.
  collections.prices.set(`${SERVER}__a`, {
    server: SERVER, itemId: 'a', itemName: 'Apple',
    buyPrice: 1, sellPrice: 12, sellPriceHigh: 15, firstSeenAt: 5, updatedAt: 5,
  });

  // --- sync 1 (new canonical docs) ---
  // Phase-2 writes go through db.batch() now (no transaction), so ALL
  // current-price + history writes are counted in batchSets.
  const before1 = { batch: counters.batchSets };
  await priceService.applyPriceUpdate(payloadAt(0));
  assert.equal(counters.batchSets - before1.batch, 6, 'sync1: 3 canonical writes + 3 history points');

  // Legacy merge: high survives (max(12->high 15) vs incoming 10), firstSeen=5
  const a = collections.prices.get(priceService.priceDocId(SERVER, 'a'));
  assert.equal(a.sellPriceHigh, 15, 'legacy sellPriceHigh preserved');
  assert.equal(a.firstSeenAt, 5, 'legacy firstSeenAt preserved');

  // --- sync 2: IDENTICAL payload, later timestamp -> total Firestore no-op ---
  const before2 = { tx: counters.txSets, gets: counters.txGets, batch: counters.batchSets };
  await priceService.applyPriceUpdate(payloadAt(1000));
  assert.equal(counters.txSets - before2.tx, 0, 'sync2: zero current-price writes when unchanged');
  assert.equal(counters.txGets - before2.gets, 0, 'sync2: zero transaction reads (memory classification)');
  assert.equal(counters.batchSets - before2.batch, 0, 'sync2: zero history writes when unchanged');

  // --- sync 3: only item "b" changes price ---
  const before3 = { gets: counters.txGets, all: counters.getAllCalls, batch: counters.batchSets };
  await priceService.applyPriceUpdate(payloadAt(2000, { sell: 25 }));
  assert.equal(counters.txGets - before3.gets, 0, 'sync3: zero reads — blind merge writes from memory');
  assert.equal(counters.getAllCalls - before3.all, 0, 'sync3: no legacy lookups for migrated items');
  assert.equal(counters.batchSets - before3.batch, 2, 'sync3: 1 canonical write + 1 history point');

  const b = collections.prices.get(priceService.priceDocId(SERVER, 'b'));
  assert.equal(b.sellPrice, 25, 'new price stored');
  assert.equal(b.updatedAt, BASE + 2000, 'updatedAt reflects the real change time');
  const unchangedA = collections.prices.get(priceService.priceDocId(SERVER, 'a'));
  assert.equal(unchangedA.updatedAt, BASE, 'unchanged item keeps its old updatedAt');

  // --- sync 4: price falls back down — sellPriceHigh must NOT regress ---
  await priceService.applyPriceUpdate(payloadAt(3000, { sell: 21 }));
  const bAfterDrop = collections.prices.get(priceService.priceDocId(SERVER, 'b'));
  assert.equal(bAfterDrop.sellPrice, 21);
  assert.equal(bAfterDrop.sellPriceHigh, 25, 'sellPriceHigh stays at the observed maximum');

  // --- history served from the in-memory store -----------------------------
  // First call may pay the ONE-TIME store load (a single bounded query);
  // every call after that must be Firestore-free.
  const hist1 = await priceService.getItemHistory(SERVER, 'b', 10);
  const scansAfterLoad = counters.histScans;
  const hist2 = await priceService.getItemHistory(SERVER, 'b', 10);
  assert.ok(counters.histScans <= scansAfterLoad + 0 + 1, 'at most the one-time store load');
  assert.equal(counters.histScans - scansAfterLoad, 0, 'repeat getItemHistory never queries Firestore');
  assert.ok(hist1.length >= 2, 'b has its change points (25 then 21)');
  assert.equal(hist1[0].sell, 21, 'newest point first');
  assert.equal(hist1[1].sell, 25);
  assert.deepEqual(hist1, hist2, 'repeat reads are consistent');
  assert.equal(hist1[0].created_at, BASE + 3000);

  // --- stats ride the same store: summary reflects the change read-free ---
  const scansBeforeStats = counters.histScans;
  const summary = await statsService.getSummary(SERVER);
  assert.equal(counters.histScans - scansBeforeStats, 0, 'getSummary never queries Firestore for history');
  assert.equal(summary.recentUpdates[0].id, 'b', 'latest real change surfaces in recent updates');
  assert.equal(summary.recentUpdates[0].created_at, BASE + 3000);
});

test('legacy lookup fires once per new item, then adaptively skipped', async () => {
  // Fresh item "d" whose legacy alias carries durable fields to merge.
  collections.prices.set(`${SERVER}__d`, {
    server: SERVER, itemId: 'd', itemName: 'Durian',
    buyPrice: 4, sellPrice: 40, sellPriceHigh: 55, firstSeenAt: 7,
  });
  const payload = {
    server: SERVER,
    timestamp: BASE + 5000,
    prices: [{ id: 'd', name: 'Durian', buy: 4, sell: 40 }],
  };

  const before = counters.getAllCalls;
  await priceService.applyPriceUpdate(payload);
  assert.ok(counters.getAllCalls > before, 'getAll fires for not-yet-migrated items');
  const d = collections.prices.get(priceService.priceDocId(SERVER, 'd'));
  assert.equal(d.sellPriceHigh, 55, 'legacy high merged into canonical doc');
  assert.equal(d.firstSeenAt, 7, 'legacy firstSeen merged into canonical doc');

  // Identical resync: item already migrated + memory row present -> the
  // whole sync is a Firestore no-op (no legacy lookup, no transaction).
  const afterFirstSync = { gets: counters.txGets, all: counters.getAllCalls };
  await priceService.applyPriceUpdate(payload);
  assert.equal(counters.getAllCalls, afterFirstSync.all, 'migrated items skip the legacy lookup entirely');
  assert.equal(counters.txGets, afterFirstSync.gets, 'unchanged items never touch Firestore at all');
});

test('alerts trigger from the RAM cache without re-querying Firestore', async () => {
  const alerts = require('../services/alertsService');
  collections.priceAlerts.set('alert1', {
    userId: 'u1', server: SERVER, itemId: 'b', itemName: 'Banana',
    thresholdType: 'above', thresholdValue: 22, triggeredAt: null,
  });

  // First call primes the cache (one query); price 21 < threshold → no trigger.
  await alerts.checkAndTriggerBatch(SERVER, [{ itemId: 'b', sellPrice: 21 }]);
  const scansAfterPrime = counters.alertScans;

  // Second identical check must be served entirely from memory.
  await alerts.checkAndTriggerBatch(SERVER, [{ itemId: 'b', sellPrice: 21 }]);
  assert.equal(counters.alertScans - scansAfterPrime, 0, 'repeat alert check never queries Firestore');

  // Crossing the threshold triggers via a blind update write (no read).
  const triggered = await alerts.checkAndTriggerBatch(SERVER, [{ itemId: 'b', sellPrice: 30 }]);
  assert.equal(triggered.length, 1, 'crossed threshold fires exactly once');
  assert.ok(collections.priceAlerts.get('alert1').triggeredAt != null, 'Firestore row updated');

  // The cache-patched row must not re-fire on later syncs.
  const again = await alerts.checkAndTriggerBatch(SERVER, [{ itemId: 'b', sellPrice: 31 }]);
  assert.equal(again.length, 0, 'already-triggered alert is skipped');
});
