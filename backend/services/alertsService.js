const { db } = require('../database/firestore');
const alertsCol = db.collection('priceAlerts');
const { getServerAliases } = require('./serverIdentity');
const { isValidFirestoreIdSegment } = require('./validation');
const crypto = require('crypto');
const quotaCol = db.collection('userQuotas');

function quotaDocId(userId) {
  return crypto.createHash('sha256').update(String(userId), 'utf8').digest('hex');
}

async function create(userId, { server, itemId, itemName, thresholdType, thresholdValue }, maxAlerts = 50) {
  if (!isValidFirestoreIdSegment(server) || !isValidFirestoreIdSegment(itemId)) {
    const error = new Error('Invalid server or itemId');
    error.status = 400;
    throw error;
  }
  if (typeof itemName !== 'string' || itemName.trim().length === 0 || itemName.length > 300) {
    const error = new Error('Invalid itemName');
    error.status = 400;
    throw error;
  }
  if (!['above', 'below'].includes(thresholdType) || !Number.isFinite(thresholdValue) || thresholdValue < 0) {
    const error = new Error('Invalid alert threshold');
    error.status = 400;
    throw error;
  }
  const ref = alertsCol.doc();
  const quotaRef = quotaCol.doc(quotaDocId(userId));
  await db.runTransaction(async (tx) => {
    await tx.get(quotaRef);
    // The quota document is only a cache of the real count. Legacy data and
    // interrupted migrations can leave it stale, so correctness must come
    // from the authoritative alert collection on every mutation. The query
    // is part of the transaction, so concurrent creates that change the same
    // user's alert set are retried instead of both accepting a stale count.
    const countSnap = await tx.get(alertsCol.where('userId', '==', userId));
    const count = countSnap.size;
    if (count >= maxAlerts) {
      const error = new Error(`You have reached the maximum number of alerts (${maxAlerts})`);
      error.status = 409;
      throw error;
    }
    tx.create(ref, { userId, server, itemId, itemName, thresholdType, thresholdValue, createdAt: Math.floor(Date.now() / 1000), triggeredAt: null });
    tx.set(quotaRef, { userId, alertCount: count + 1, updatedAt: Math.floor(Date.now() / 1000) }, { merge: true });
  });
  invalidateAlertsCache();
}

async function list(userId) {
  const snapshot = await alertsCol.where('userId', '==', userId).get();
  const rows = snapshot.docs.map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      server: d.server,
      itemId: d.itemId,
      itemName: d.itemName,
      thresholdType: d.thresholdType,
      thresholdValue: d.thresholdValue,
      createdAt: d.createdAt,
      triggeredAt: d.triggeredAt,
    };
  });
  rows.sort((a, b) => b.createdAt - a.createdAt);
  return rows;
}

async function remove(userId, alertId) {
  const ref = alertsCol.doc(alertId);
  const quotaRef = quotaCol.doc(quotaDocId(userId));
  await db.runTransaction(async (tx) => {
    await tx.get(quotaRef);
    const doc = await tx.get(ref);
    if (!doc.exists || doc.data().userId !== userId) return;

    const countSnap = await tx.get(alertsCol.where('userId', '==', userId));
    const count = countSnap.size;
    tx.delete(ref);
    tx.set(quotaRef, { userId, alertCount: Math.max(0, count - 1), updatedAt: Math.floor(Date.now() / 1000) }, { merge: true });
  });
  invalidateAlertsCache();
}

/**
 * In-memory cache of UNTRIGGERED alert rows per canonical server name.
 * Same single-writer argument as priceService's stores: every alert
 * mutation (create/remove/trigger) flows through this process, so the
 * cache can be kept exact by patching it on each mutation instead of
 * re-querying Firestore on every price sync. A TTL guards against drift.
 */
const ALERTS_CACHE_TTL_MS = 10 * 60_000;
// Servers with NO active alerts re-check rarely: an empty result can only
// change when a user creates an alert (same process → cache invalidated),
// so a long negative TTL is safe and keeps truly quiet servers at ~0 reads.
const ALERTS_CACHE_EMPTY_TTL_MS = 30 * 60_000;
const activeAlertsCache = new Map(); // server -> { at, rows: [{ id, data }], empty }

function invalidateAlertsCache() {
  activeAlertsCache.clear();
}

async function getActiveAlertDocs(server) {
  const cached = activeAlertsCache.get(server);
  if (cached) {
    const ttl = cached.empty ? ALERTS_CACHE_EMPTY_TTL_MS : ALERTS_CACHE_TTL_MS;
    if (Date.now() - cached.at < ttl) return cached.rows;
  }

  const aliases = Array.from(new Set(await getServerAliases(server)));
  const snapshots = [];
  for (let start = 0; start < aliases.length; start += 30) {
    const chunk = aliases.slice(start, start + 30);
    if (chunk.length === 1) {
      snapshots.push(await alertsCol.where('server', '==', chunk[0]).where('triggeredAt', '==', null).get());
    } else {
      snapshots.push(await alertsCol.where('server', 'in', chunk).where('triggeredAt', '==', null).get());
    }
  }
  const rows = [];
  const seenDocIds = new Set();
  for (const snapshot of snapshots) {
    for (const doc of snapshot.docs) {
      if (!seenDocIds.has(doc.id)) {
        seenDocIds.add(doc.id);
        rows.push({ id: doc.id, data: doc.data() });
      }
    }
  }
  activeAlertsCache.set(server, { at: Date.now(), rows, empty: rows.length === 0 });
  return rows;
}

/**
 * Checks all active alerts for a server. Served from the in-memory cache —
 * ZERO Firestore reads in steady state. Triggering is a blind update write
 * (no read needed): the cache already knows the alert is untriggered.
 */
async function checkAndTriggerBatch(server, updates) {
  const sellByItem = new Map();
  for (const { itemId, sellPrice } of updates) {
    if (typeof sellPrice === 'number' && Number.isFinite(sellPrice) && sellPrice >= 0) {
      sellByItem.set(itemId, sellPrice);
    }
  }
  if (sellByItem.size === 0) return [];

  const docs = await getActiveAlertDocs(server);
  if (docs.length === 0) return [];

  const now = Math.floor(Date.now() / 1000);
  const candidates = docs.filter((row) => sellByItem.has(row.data.itemId));
  const triggered = [];

  // Bound concurrent trigger writes so a server with many users' alerts
  // cannot create an unbounded burst of Firestore writes.
  const CONCURRENCY = 20;
  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const chunk = candidates.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(async (row) => {
      const alert = row.data;
      if (alert.triggeredAt != null) return null; // already fired (cache-patched)
      const crossed =
        (alert.thresholdType === 'above' && sellByItem.get(alert.itemId) >= alert.thresholdValue) ||
        (alert.thresholdType === 'below' && sellByItem.get(alert.itemId) <= alert.thresholdValue);
      if (!crossed) return null;
      await alertsCol.doc(row.id).update({ triggeredAt: now });
      // Patch the cache row in place so later syncs skip this alert.
      alert.triggeredAt = now;
      return { id: row.id, ...alert, triggeredAt: now };
    }));
    for (const result of results) if (result) triggered.push(result);
  }

  return triggered;
}

module.exports = { create, list, remove, checkAndTriggerBatch };
