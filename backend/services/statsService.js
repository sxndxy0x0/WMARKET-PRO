const { db } = require('../database/firestore');
const priceService = require('./priceService');
const cache = require('./cache');

const DAY_SECONDS = 24 * 60 * 60;

// Total item count is derived from priceService's in-memory rows (no extra
// scan); this wrapper just throttles recompute frequency.
const TOTAL_ITEMS_TTL_MS = 300_000;

/**
 * History source: priceService's IN-MEMORY store (see the block comment on
 * MAX_RECENT_HISTORY_DOCS there). It is loaded once per server with ONE
 * bounded (server ASC, createdAt DESC) composite-index query — see
 * firestore.indexes.json — and patched in-process whenever applyPriceUpdate
 * commits new points. Stats therefore cost ZERO Firestore reads between
 * restarts. The dedupe below keeps parity with the previous query-then-
 * dedupe behavior for legacy case-variant rows.
 */
function dedupeHistoryRows(rows) {
  const byKey = new Map();
  for (const row of rows) {
    if (typeof row.itemId !== 'string' || !row.itemId || !Number.isFinite(row.createdAt)) continue;
    if (!Number.isFinite(row.sellPrice) && row.sellPrice !== -1) continue;
    const key = `${row.itemId}\u0000${row.createdAt}\u0000${row.buyPrice}\u0000${row.sellPrice}\u0000${row.stackPrice ?? ''}`;
    if (!byKey.has(key)) byKey.set(key, row);
  }
  return [...byKey.values()];
}

async function fetchRecentHistoryCached(server) {
  return dedupeHistoryRows(await priceService.getRecentHistoryDocs(server));
}

async function getTotalItems(server) {
  return cache.getOrLoad(`totalItems:${server}`, TOTAL_ITEMS_TTL_MS, async () => {
    const items = await priceService.getItems(server);
    return items.length;
  });
}

function getNewToday(history, currentPrices = []) {
  const now = Math.floor(Date.now() / 1000);
  const todayStart = now - (now % DAY_SECONDS);

  const knownIds = new Set();
  let count = 0;
  for (const row of currentPrices) {
    if (Number.isFinite(row.first_seen_at)) {
      knownIds.add(row.id);
      if (row.first_seen_at >= todayStart) count++;
    }
  }

  // Legacy price documents may not have firstSeenAt yet. Estimate those
  // remaining items from the available history window without double-counting
  // items whose firstSeenAt is already authoritative.
  const earliestSeenByItem = new Map();
  for (const row of history) {
    if (knownIds.has(row.itemId)) continue;
    const prev = earliestSeenByItem.get(row.itemId);
    if (prev === undefined || row.createdAt < prev) earliestSeenByItem.set(row.itemId, row.createdAt);
  }
  for (const earliest of earliestSeenByItem.values()) {
    if (earliest >= todayStart) count++;
  }
  return count;
}

function getRecentUpdates(history, limit = 10) {
  return [...history]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map((r) => ({ id: r.itemId, name: r.itemName, sell: r.sellPrice, created_at: r.createdAt }));
}

/**
 * For each item, compares its most recent price to the closest history
 * record at/before 24h ago (within the 7-day in-memory history window). Items
 * with no such baseline (too new) are excluded from ranking — nothing to
 * compare against yet.
 */
function getPriceChanges(history, limit = 5) {
  const cutoff24h = Math.floor(Date.now() / 1000) - DAY_SECONDS;

  const byItem = new Map();
  for (const row of history) {
    if (!byItem.has(row.itemId)) byItem.set(row.itemId, []);
    byItem.get(row.itemId).push(row);
  }

  const withChange = [];
  for (const [itemId, rows] of byItem) {
    rows.sort((a, b) => a.createdAt - b.createdAt);
    const latest = rows[rows.length - 1];

    // Latest record at/before the 24h-ago cutoff.
    let baseline = null;
    for (const row of rows) {
      if (row.createdAt <= cutoff24h) baseline = row;
      else break;
    }
    if (!baseline || baseline.sellPrice <= 0 || latest.sellPrice == null || latest.sellPrice < 0) continue;

    withChange.push({
      id: itemId,
      name: latest.itemName,
      currentSell: latest.sellPrice,
      pastSell: baseline.sellPrice,
      changePct: ((latest.sellPrice - baseline.sellPrice) / baseline.sellPrice) * 100,
    });
  }

  const avgChangePct = withChange.length
    ? withChange.reduce((sum, r) => sum + r.changePct, 0) / withChange.length
    : null;

  const sorted = [...withChange].sort((a, b) => b.changePct - a.changePct);

  return { avgChangePct, gainers: sorted.slice(0, limit) };
}

/** Daily average sell price across all items, normalized to % change from the first day. */
function getTimeseries(history) {
  const byDay = new Map();
  for (const row of history) {
    if (row.sellPrice == null || row.sellPrice < 0) continue;
    const dayBucket = row.createdAt - (row.createdAt % DAY_SECONDS);
    if (!byDay.has(dayBucket)) byDay.set(dayBucket, []);
    byDay.get(dayBucket).push(row.sellPrice);
  }

  const days = [...byDay.entries()].sort((a, b) => a[0] - b[0]);
  if (days.length === 0) return [];

  const dayAverages = days.map(([date, prices]) => ({
    date,
    avgSell: prices.reduce((s, p) => s + p, 0) / prices.length,
  }));

  const baseline = dayAverages[0].avgSell;
  return dayAverages.map((d) => ({
    date: d.date,
    avgSell: d.avgSell,
    changePct: baseline > 0 ? ((d.avgSell - baseline) / baseline) * 100 : 0,
  }));
}

async function getSummary(server) {
  const [totalItems, history, currentPrices] = await Promise.all([
    getTotalItems(server),
    fetchRecentHistoryCached(server),
    priceService.getCurrentPrices(server),
  ]);
  const { avgChangePct, gainers } = getPriceChanges(history, 100);

  let recentUpdates = getRecentUpdates(history);
  if (recentUpdates.length === 0 && currentPrices.length > 0) {
    recentUpdates = [...currentPrices]
      .sort((a, b) => b.updated_at - a.updated_at)
      .slice(0, 10)
      .map((p) => ({ id: p.id, name: p.name, sell: p.sell, created_at: p.updated_at }));
  }

  return {
    totalItems,
    newToday: getNewToday(history, currentPrices),
    avgChangePct,
    gainers,
    recentUpdates,
    // NOT tracked by the mod — the /worth GUI shows prices, not trade volume
    // or transaction counts. Exposed as null (not a fake number) so the
    // frontend can render an explicit "not available" state.
    volume24h: null,
  };
}

async function getTimeseriesForServer(server) {
  const history = await fetchRecentHistoryCached(server);
  return getTimeseries(history);
}

module.exports = { getSummary, getTimeseries: getTimeseriesForServer };
