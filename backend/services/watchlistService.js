const { db } = require('../database/firestore');
const pricesCol = db.collection('prices');
const { serverIdentityKey, getServerAliases } = require('./serverIdentity');
const { priceDocId } = require('./priceService');
const watchlistCol = db.collection('watchlist');
const quotaCol = db.collection('userQuotas');
const crypto = require('crypto');

function quotaDocId(userId) {
  return crypto.createHash('sha256').update(String(userId), 'utf8').digest('hex');
}

// Deterministic doc id doubles as the unique constraint (userId, server,
// itemId) that a SQL UNIQUE index would have given us — adding the same
// item twice just overwrites the same doc instead of creating a duplicate.
function legacyWatchlistDocId(userId, server, itemId) {
  // The legacy separator is ambiguous when any segment contains `__`.
  // Never probe/create such an ID for new operations: it could collide with
  // a different (user, server, item) tuple and cause an unrelated watchlist
  // entry to be deleted or merged. Legacy IDs that were unambiguous remain
  // readable for backwards compatibility.
  if (userId.includes('__') || server.includes('__') || itemId.includes('__')) return null;
  return `${userId}__${server}__${itemId}`;
}

function watchlistDocId(userId, server, itemId) {
  // Keep existing safe IDs stable. If a segment contains the legacy `__`
  // delimiter, use a collision-proof hash for new writes.
  if (!userId.includes('__') && !server.includes('__') && !itemId.includes('__')) {
    return legacyWatchlistDocId(userId, server, itemId);
  }
  return `v2_${crypto.createHash('sha256').update(`${userId}\u0000${server}\u0000${itemId}`, 'utf8').digest('hex')}`;
}

async function add(userId, server, itemId, maxItems = 100) {
  const aliases = Array.from(new Set(await getServerAliases(server)));
  const refs = aliases.flatMap((alias) => {
    const ids = new Set([watchlistDocId(userId, alias, itemId)]);
    const legacyId = legacyWatchlistDocId(userId, alias, itemId);
    if (legacyId) ids.add(legacyId);
    return [...ids].map((id) => ({ alias, ref: watchlistCol.doc(id) }));
  });
  const canonicalRef = watchlistCol.doc(watchlistDocId(userId, server, itemId));
  const quotaRef = quotaCol.doc(quotaDocId(userId));
  await db.runTransaction(async (tx) => {
    await tx.get(quotaRef);
    const existingDocs = await Promise.all(refs.map(({ ref }) => tx.get(ref)));
    const actualCountSnap = await tx.get(watchlistCol.where('userId', '==', userId));
    const actualCount = actualCountSnap.size;
    const existingAny = existingDocs.some((doc) => doc.exists && doc.data().userId === userId);
    if (existingAny) {
      // Collapse any legacy-case duplicate into the canonical document so the
      // quota count and future delete both see one physical record.
      const existingOwned = existingDocs.filter((doc) => doc.exists && doc.data().userId === userId);
      let canonicalCreatedAt = existingOwned.find((doc) => doc.id === canonicalRef.id)?.data().createdAt;
      if (!Number.isFinite(canonicalCreatedAt)) {
        canonicalCreatedAt = Math.min(...existingOwned.map((doc) => Number.isFinite(doc.data().createdAt) ? doc.data().createdAt : Math.floor(Date.now() / 1000)));
      }
      tx.set(canonicalRef, { userId, server, itemId, createdAt: canonicalCreatedAt }, { merge: true });
      for (const doc of existingOwned) {
        if (doc.id !== canonicalRef.id) tx.delete(doc.ref);
      }
      // Reconcile the quota cache even when legacy duplicates were found.
      // The actual collection count is authoritative. Collapsing N physical
      // duplicates into one canonical record reduces the count by N-1.
      const reconciledCount = Math.max(0, actualCount - Math.max(0, existingOwned.length - 1));
      tx.set(quotaRef, { userId, watchlistCount: reconciledCount, updatedAt: Math.floor(Date.now() / 1000) }, { merge: true });
      return;
    }

    const count = actualCount;
    if (count >= maxItems) {
      const error = new Error(`You have reached the maximum number of watchlist items (${maxItems})`);
      error.status = 409;
      throw error;
    }
    tx.create(ref, { userId, server, itemId, createdAt: Math.floor(Date.now() / 1000) });
    tx.set(quotaRef, { userId, watchlistCount: count + 1, updatedAt: Math.floor(Date.now() / 1000) }, { merge: true });
  });
}

async function remove(userId, server, itemId) {
  const aliases = Array.from(new Set(await getServerAliases(server)));
  const refs = aliases.flatMap((alias) => {
    const ids = new Set([watchlistDocId(userId, alias, itemId)]);
    const legacyId = legacyWatchlistDocId(userId, alias, itemId);
    if (legacyId) ids.add(legacyId);
    return [...ids].map((id) => watchlistCol.doc(id));
  });
  const quotaRef = quotaCol.doc(quotaDocId(userId));
  await db.runTransaction(async (tx) => {
    await tx.get(quotaRef);
    const existingDocs = await Promise.all(refs.map((ref) => tx.get(ref)));
    const existing = existingDocs.filter((doc) => doc.exists && doc.data().userId === userId);
    if (existing.length === 0) return;

    const countSnap = await tx.get(watchlistCol.where('userId', '==', userId));
    const count = countSnap.size;
    for (const doc of existing) tx.delete(doc.ref);
    tx.set(quotaRef, { userId, watchlistCount: Math.max(0, count - existing.length), updatedAt: Math.floor(Date.now() / 1000) }, { merge: true });
  });
}

/**
 * Returns the user's watchlist joined with current price data. Firestore
 * has no server-side JOIN, so this does the watchlist query first, then
 * batch-fetches all referenced price docs in a single getAll() call.
 */
async function list(userId) {
  const snapshot = await watchlistCol.where('userId', '==', userId).get();
  const byIdentity = new Map();
  for (const doc of snapshot.docs) {
    const entry = doc.data();
    const identity = serverIdentityKey(entry.server);
    if (!identity || typeof entry.itemId !== 'string' || !entry.itemId) continue;
    const key = `${identity}\u0000${entry.itemId}`;
    const previous = byIdentity.get(key);
    if (!previous || entry.createdAt > previous.createdAt) byIdentity.set(key, entry);
  }
  const entries = [...byIdentity.values()];
  entries.sort((a, b) => b.createdAt - a.createdAt);

  if (entries.length === 0) return [];

  // Batch-fetch all referenced aliases. Legacy entries can use a different
  // case variant from the canonical server, so include all known aliases.
  const refPairs = [];
  for (const entry of entries) {
    const aliases = Array.from(new Set(await getServerAliases(entry.server)));
    for (const alias of aliases) refPairs.push({ entry, ref: pricesCol.doc(priceDocId(alias, entry.itemId)) });
  }
  const priceByKey = new Map();
  for (let start = 0; start < refPairs.length; start += 400) {
    const chunk = refPairs.slice(start, start + 400);
    const priceDocs = await db.getAll(...chunk.map((pair) => pair.ref));
    for (let i = 0; i < chunk.length; i++) {
      if (!priceDocs[i].exists) continue;
      const key = `${serverIdentityKey(chunk[i].entry.server)}\u0000${chunk[i].entry.itemId}`;
      const data = priceDocs[i].data();
      const previous = priceByKey.get(key);
      if (!previous) {
        priceByKey.set(key, data);
        continue;
      }
      // A legacy case-variant document can coexist with the canonical
      // document. Never let alias iteration order decide which price wins.
      // Prefer the newest current price, while preserving durable aggregate
      // fields accumulated across the legacy documents.
      const previousUpdatedAt = Number.isFinite(previous.updatedAt) ? previous.updatedAt : -Infinity;
      const currentUpdatedAt = Number.isFinite(data.updatedAt) ? data.updatedAt : -Infinity;
      const latest = currentUpdatedAt >= previousUpdatedAt ? data : previous;
      const previousHigh = Number.isFinite(previous.sellPriceHigh) ? previous.sellPriceHigh : previous.sellPrice;
      const currentHigh = Number.isFinite(data.sellPriceHigh) ? data.sellPriceHigh : data.sellPrice;
      const previousFirstSeen = Number.isFinite(previous.firstSeenAt) ? previous.firstSeenAt : null;
      const currentFirstSeen = Number.isFinite(data.firstSeenAt) ? data.firstSeenAt : null;
      priceByKey.set(key, {
        ...latest,
        sellPriceHigh: Math.max(
          Number.isFinite(previousHigh) ? previousHigh : -1,
          Number.isFinite(currentHigh) ? currentHigh : -1
        ),
        ...(previousFirstSeen == null && currentFirstSeen == null
          ? {}
          : { firstSeenAt: previousFirstSeen == null ? currentFirstSeen : currentFirstSeen == null ? previousFirstSeen : Math.min(previousFirstSeen, currentFirstSeen) }),
      });
    }
  }

  const results = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const p = priceByKey.get(`${serverIdentityKey(entry.server)}\u0000${entry.itemId}`) || null;
    results.push({
      id: entry.itemId,
      server: entry.server,
      name: p?.itemName ?? entry.itemId,
      buy: p?.buyPrice ?? -1,
      sell: p?.sellPrice ?? -1,
      sellHigh: p?.sellPriceHigh ?? -1,
      stackPrice: p?.stackPrice ?? -1,
      updated_at: p?.updatedAt ?? null,
      watchedAt: entry.createdAt,
    });
  }
  return results;
}

module.exports = { add, remove, list };
