const { db } = require('../database/firestore');
const cache = require('./cache');
const { queryByServer } = require('./serverQueries');
const crypto = require('crypto');

// Current prices are served from an IN-MEMORY store that is kept authoritative
// by applyPriceUpdate(): every mod sync flows through this single process, so
// once rows are loaded (one full scan on first touch after boot) they are
// patched incrementally on every accepted write and getCurrentPrices never
// re-scans Firestore again. This converts the biggest recurring read cost —
// a 350–1250-doc collection scan per poll window per server — into ~zero,
// at the cost of one assumption: Firestore prices are only ever written by
// THIS backend (manual console edits would be invisible until restart).
// History is ALSO served from an in-memory store (same single-writer
// argument as current prices): loaded once per server as ONE bounded
// newest-first query, then patched in-process every time this backend
// appends a history point. Sparkline bursts and dashboard stats therefore
// cost ZERO Firestore reads between restarts. The bounded loader needs the
// (server ASC, createdAt DESC) composite index — see firestore.indexes.json.
const RECENT_HISTORY_WINDOW_SECONDS = 7 * 24 * 60 * 60;
const MAX_RECENT_HISTORY_DOCS = 5000;

/**
 * Firestore collections used:
 *  - `prices`:       deterministic doc ID (legacy-safe or v2 hash)
 *  - `priceHistory`: deterministic v2 hash ID (append-only and retry-safe)
 *
 * NOTE on indexes: queries below are written to only need Firestore's
 * automatic single-field indexes (no composite index setup required) by
 * doing at most one `where` + sorting/limiting in application code instead
 * of chaining `.orderBy()` in the query. If you later change these queries
 * to add `.orderBy()` alongside a `.where()`, Firestore may respond with a
 * "FAILED_PRECONDITION: query requires an index" error — just click the
 * link it gives you in that error to auto-create the index (one-time setup,
 * not a bug).
 */

const pricesCol = db.collection('prices');
const historyCol = db.collection('priceHistory');

// In-memory authoritative rows: server -> Map<itemId, row>. See the block
// comment above CURRENT_PRICES… removal note (top of file) for why this
// exists. Row shape matches getCurrentPrices' output objects exactly.
const currentRowsByServer = new Map();
// De-duplicates concurrent first-touch loads per server.
const loadingServers = new Map();

async function ensureCurrentRows(server) {
  loadSnapshotSync();
  const existing = currentRowsByServer.get(server);
  if (existing) return existing;
  const inflight = loadingServers.get(server);
  if (inflight) return inflight;
  const load = (async () => {
    const docs = await queryByServer(pricesCol, server, (query) => query);
    const byItem = new Map();
    for (const doc of docs) {
      const d = doc.data();
      const row = {
        id: d.itemId,
        name: d.itemName,
        buy: d.buyPrice,
        sell: d.sellPrice,
        sellHigh: typeof d.sellPriceHigh === 'number' ? d.sellPriceHigh : d.sellPrice,
        stackPrice: d.stackPrice ?? null,
        updated_at: Number.isFinite(d.updatedAt) ? d.updatedAt : 0,
        first_seen_at: Number.isFinite(d.firstSeenAt) ? d.firstSeenAt : null,
      };
      if (!row.id) continue;
      const previous = byItem.get(row.id);
      if (!previous) {
        byItem.set(row.id, row);
        continue;
      }
      // Legacy aliases can temporarily contain multiple physical price docs.
      // Merge durable fields instead of letting whichever alias happens to be
      // read last erase firstSeenAt or the accumulated high price.
      const latest = row.updated_at >= previous.updated_at ? row : previous;
      byItem.set(row.id, {
        ...latest,
        sellHigh: Math.max(
          Number.isFinite(previous.sellHigh) ? previous.sellHigh : -1,
          Number.isFinite(row.sellHigh) ? row.sellHigh : -1
        ),
        first_seen_at: previous.first_seen_at == null
          ? row.first_seen_at
          : row.first_seen_at == null
            ? previous.first_seen_at
            : Math.min(previous.first_seen_at, row.first_seen_at),
      });
    }
    currentRowsByServer.set(server, byItem);
    return byItem;
  })();
  loadingServers.set(server, load);
  try {
    return await load;
  } finally {
    loadingServers.delete(server);
  }
}

// ---- in-memory history store ---------------------------------------------
// server -> plain history rows, NEWEST FIRST. Row shape matches what
// Firestore documents store ({itemId,itemName,buyPrice,sellPrice,
// stackPrice,createdAt}) so both getItemHistory and statsService consume
// the same objects.
const historyByServer = new Map();
const loadingHistory = new Map();

async function ensureRecentHistory(server) {
  loadSnapshotSync();
  const existing = historyByServer.get(server);
  if (existing) return existing;
  const inflight = loadingHistory.get(server);
  if (inflight) return inflight;
  const load = (async () => {
    const cutoff = Math.floor(Date.now() / 1000) - RECENT_HISTORY_WINDOW_SECONDS;
    const docs = await queryByServer(historyCol, server, (query) => query
      .where('createdAt', '>=', cutoff)
      .orderBy('createdAt', 'desc')
      .limit(MAX_RECENT_HISTORY_DOCS));
    const rows = [];
    for (const doc of docs) {
      const d = doc.data();
      if (typeof d?.itemId !== 'string' || !d.itemId || !Number.isFinite(d.createdAt)) continue;
      rows.push(d); // query already returns newest-first
    }
    historyByServer.set(server, rows);
    return rows;
  })();
  loadingHistory.set(server, load);
  try {
    return await load;
  } finally {
    loadingHistory.delete(server);
  }
}

/** Insert freshly-committed history points keeping newest-first order. */
function insertHistoryRows(server, newRows) {
  if (!Array.isArray(newRows) || newRows.length === 0) return;
  const arr = historyByServer.get(server);
  if (!arr) return; // not loaded yet — the next ensureRecentHistory picks them up
  for (const row of newRows) {
    let i = 0;
    while (i < arr.length && (arr[i].createdAt ?? 0) > (row.createdAt ?? 0)) i++;
    arr.splice(i, 0, row);
  }
  if (arr.length > MAX_RECENT_HISTORY_DOCS) arr.length = MAX_RECENT_HISTORY_DOCS;
}

// ---- optional disk snapshot (PRICE_SNAPSHOT=on) ---------------------------
// Persists the two in-memory stores to backend/data/price-cache.json so a
// restart costs ZERO Firestore reads. Opt-in because it hardens the
// single-writer assumption: while enabled, manual Firestore edits stay
// invisible even across restarts (delete the file or unset the env to force
// one full rescan). Writes are debounced 3s and atomic (tmp+rename); any
// read/parse error is silently ignored and we fall back to a normal scan.
const SNAPSHOT_ENABLED = process.env.PRICE_SNAPSHOT === 'on';
const SNAPSHOT_PATH = require('node:path').join(__dirname, '..', 'data', 'price-cache.json');
let snapshotLoaded = false;
let snapshotSaveTimer = null;

function loadSnapshotSync() {
  if (!SNAPSHOT_ENABLED || snapshotLoaded) return;
  snapshotLoaded = true;
  try {
    const data = JSON.parse(require('node:fs').readFileSync(SNAPSHOT_PATH, 'utf8'));
    if (!data || data.v !== 1) return;
    const cutoff = Math.floor(Date.now() / 1000) - RECENT_HISTORY_WINDOW_SECONDS;
    for (const [srv, entry] of Object.entries(data.prices || {})) {
      if (!entry || !Array.isArray(entry.rows)) continue;
      const map = new Map();
      for (const row of entry.rows) {
        if (row && typeof row.id === 'string' && row.id && !map.has(row.id)) map.set(row.id, row);
      }
      if (map.size > 0) currentRowsByServer.set(srv, map);
      // Hydrated rows already carry their merged legacy fields.
      const done = legacyMigrationDone.get(srv) ?? new Set();
      for (const id of map.keys()) done.add(id);
      legacyMigrationDone.set(srv, done);
    }
    for (const [srv, entry] of Object.entries(data.history || {})) {
      if (!entry || !Array.isArray(entry.rows)) continue;
      const arr = entry.rows
        .filter((r) => r && typeof r.itemId === 'string' && Number.isFinite(r.createdAt) && r.createdAt >= cutoff)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, MAX_RECENT_HISTORY_DOCS);
      if (arr.length > 0) historyByServer.set(srv, arr);
    }
  } catch { /* missing/corrupt file → normal Firestore scan path */ }
}

function scheduleSnapshotSave() {
  if (!SNAPSHOT_ENABLED || snapshotSaveTimer) return;
  snapshotSaveTimer = setTimeout(() => {
    snapshotSaveTimer = null;
    try {
      const fs = require('node:fs');
      const out = { v: 1, savedAt: Math.floor(Date.now() / 1000), prices: {}, history: {} };
      for (const [srv, map] of currentRowsByServer) out.prices[srv] = { rows: [...map.values()] };
      for (const [srv, arr] of historyByServer) out.history[srv] = { rows: arr };
      fs.mkdirSync(require('node:path').dirname(SNAPSHOT_PATH), { recursive: true });
      const tmp = `${SNAPSHOT_PATH}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(out));
      fs.renameSync(tmp, SNAPSHOT_PATH);
      require('./githubSnapshot').noteSnapshotWritten();
    } catch { /* best-effort persistence */ }
  }, 3000);
  if (typeof snapshotSaveTimer.unref === 'function') snapshotSaveTimer.unref();
}

// Per-server set of item ids whose canonical doc has already been created
// WITH its legacy fields merged. After the first successful sync an item's
// legacy row can never gain new information (the mod writes canonical docs
// from then on), so re-reading it every sync is pure waste — and at 250
// reads/sync that waste alone could eat half the daily read quota.
// In-memory only: a backend restart simply re-runs one migration pass.
const legacyMigrationDone = new Map();

function legacyPriceDocId(server, itemId) {
  return `${server}__${itemId}`;
}

function priceDocId(server, itemId) {
  // Preserve the legacy ID for unambiguous values so existing documents keep
  // being updated in place. If either segment contains the legacy separator,
  // use a collision-proof hash instead.
  if (!server.includes('__') && !itemId.includes('__')) return legacyPriceDocId(server, itemId);
  return `v2_${crypto.createHash('sha256').update(`${server}\u0000${itemId}`, 'utf8').digest('hex')}`;
}

function historyDocId(server, itemId, timestamp, item) {
  // History IDs are append-only and must never be ambiguous when an item ID
  // contains the legacy separator. Hash the complete logical key instead of
  // concatenating variable-length segments with `__`.
  const fingerprint = crypto.createHash('sha256')
    .update(JSON.stringify({
      server,
      itemId,
      timestamp,
      buy: item.buy ?? -1,
      sell: item.sell ?? -1,
      stackPrice: item.stackPrice ?? null,
    }), 'utf8')
    .digest('hex');
  return `v2_${fingerprint}`;
}

/**
 * Applies an incoming payload (see mod's JSON FORMAT) to Firestore.
 * Updates current prices in one transaction so concurrent Mod syncs cannot
 * overwrite a higher `sellPriceHigh` or older `firstSeenAt`. History is then
 * written in one deterministic-ID batch; retrying the same sync is idempotent.
 *
 * The maximum 250-item payload stays within Firestore's 500-write batch cap
 * for the append-only history batch.
 */
async function applyPriceUpdate({ server, timestamp, prices }) {
  if (!Array.isArray(prices) || prices.length === 0 || prices.length > 250) {
    const error = new Error('prices must contain 1-250 items');
    error.status = 400;
    throw error;
  }
  const seenIds = new Set();
  for (const item of prices) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.id !== 'string' || !item.id || seenIds.has(item.id)) {
      const error = new Error('prices contains an invalid or duplicate item id');
      error.status = 400;
      throw error;
    }
    if (!Number.isFinite(item.buy) || !Number.isFinite(item.sell) ||
        (item.stackPrice !== undefined && !Number.isFinite(item.stackPrice))) {
      const error = new Error('prices contains a non-finite price value');
      error.status = 400;
      throw error;
    }
    if (typeof item.name !== 'string' || item.name.trim().length === 0 || item.name.length > 300) {
      const error = new Error('prices contains an invalid item name');
      error.status = 400;
      throw error;
    }
    seenIds.add(item.id);
  }
  const now = timestamp ?? Math.floor(Date.now() / 1000);
  const currentTime = Math.floor(Date.now() / 1000);
  const maxPastSkew = 7 * 24 * 60 * 60;
  const maxFutureSkew = 5 * 60;
  if (!Number.isInteger(now) || now <= 0 || now < currentTime - maxPastSkew || now > currentTime + maxFutureSkew) {
    const error = new Error('timestamp must be an integer Unix-seconds value within 7 days in the past or 5 minutes in the future');
    error.status = 400;
    throw error;
  }

  // Load (or reuse) this server's in-memory stores first. History must be
  // resident BEFORE we append, so freshly committed points always land in
  // the RAM store (and therefore in the disk snapshot) instead of being
  // missed by a lazy load later.
  const [rows] = await Promise.all([
    ensureCurrentRows(server),
    ensureRecentHistory(server),
  ]);

  // Legacy documents matter only for items we have never seen in memory
  // (brand-new since boot) and whose migration is unconfirmed. Everything
  // else already carries its merged sellPriceHigh/firstSeenAt in the row.
  const migrated = legacyMigrationDone.get(server) ?? new Set();
  const needsLegacyIdx = [];
  for (let i = 0; i < prices.length; i++) {
    if (!rows.has(prices[i].id) && !migrated.has(prices[i].id)) needsLegacyIdx.push(i);
  }
  let legacyHighByItemId = new Map();
  let legacyFirstSeenByItemId = new Map();
  if (needsLegacyIdx.length > 0) {
    const legacyRefs = needsLegacyIdx.map((i) => pricesCol.doc(legacyPriceDocId(server, prices[i].id)));
    const legacyDocs = await db.getAll(...legacyRefs);
    for (const doc of legacyDocs) {
      if (!doc || !doc.exists) continue;
      const d = doc.data();
      // Prefer the stored itemId; fall back to parsing the deterministic doc
      // id so a legacy row missing the field still maps to its item.
      const itemId = typeof d?.itemId === 'string' && d.itemId
        ? d.itemId
        : (doc.id.startsWith(`${server}__`) ? doc.id.slice(server.length + 2) : undefined);
      if (typeof itemId !== 'string' || !itemId) continue;
      if (Number.isFinite(d.firstSeenAt)) {
        const previous = legacyFirstSeenByItemId.get(itemId);
        legacyFirstSeenByItemId.set(itemId, previous === undefined ? d.firstSeenAt : Math.min(previous, d.firstSeenAt));
      }
      const candidateHigh = Number.isFinite(d.sellPriceHigh) ? d.sellPriceHigh : d.sellPrice;
      if (Number.isFinite(candidateHigh)) {
        const previous = legacyHighByItemId.get(itemId);
        legacyHighByItemId.set(itemId, previous === undefined ? candidateHigh : Math.max(previous, candidateHigh));
      }
    }
  }

  // ---- Phase 1: classify every incoming item against MEMORY --------------
  // Zero Firestore reads here by design: only items that will really be
  // written advance to Phase 2's transaction.
  const changedIdx = [];
  for (let i = 0; i < prices.length; i++) {
    const item = prices[i];
    const row = rows.get(item.id);
    const sellPrice = item.sell ?? -1;
    const rowHigh = Number.isFinite(row?.sellHigh) ? row.sellHigh : -1;
    const legacyHigh = legacyHighByItemId.get(item.id);
    const previousHigh = Math.max(
      rowHigh,
      Number.isFinite(legacyHigh) ? legacyHigh : -1
    );
    const prospectiveHigh = sellPrice < 0
      ? (previousHigh < 0 ? -1 : previousHigh)
      : Math.max(previousHigh < 0 ? -1 : previousHigh, sellPrice);

    const rowFirstSeen = Number.isFinite(row?.first_seen_at) ? row.first_seen_at : undefined;
    const legacyFirstSeen = legacyFirstSeenByItemId.get(item.id);
    const firstSeenCandidates = [rowFirstSeen, legacyFirstSeen].filter(Number.isFinite);
    const prospectiveFirstSeen = firstSeenCandidates.length > 0
      ? Math.min(...firstSeenCandidates)
      : undefined;

    // Delayed/retried payloads (see stale-payload note below) may only ever
    // IMPROVE durable aggregates; their buy/sell/stack values are ignored.
    const stalePayload = !!row && Number.isFinite(row.updated_at) && row.updated_at > now;
    const valuesChanged = !row || (
      !stalePayload && (
        row.name !== item.name ||
        row.buy !== (item.buy ?? -1) ||
        row.sell !== sellPrice ||
        (row.stackPrice ?? null) !== (item.stackPrice ?? null)
      )
    );
    const improvedHigh = Number.isFinite(prospectiveHigh) && prospectiveHigh > rowHigh;
    const improvedFirstSeen = prospectiveFirstSeen !== undefined
      && (!Number.isFinite(rowFirstSeen) || prospectiveFirstSeen < rowFirstSeen);

    if (valuesChanged || improvedHigh || improvedFirstSeen) changedIdx.push(i);
  }

  // ---- Phase 2: blind-merge writes over ONLY the changed subset ----------
  // ZERO Firestore reads by design. Memory is authoritative here because
  // this is a single-writer service: every price/history write flows through
  // THIS process, so re-reading docs before writing (the old tx.get) was
  // pure belt-and-braces against concurrent writers that cannot exist.
  // A stale delayed payload never regresses values: its base keeps the
  // memory row's fields and only durable aggregates may improve.
  const actuallyWritten = []; // { idx, base }
  if (changedIdx.length > 0) {
    const batch = db.batch();
    for (const i of changedIdx) {
      const item = prices[i];
      const memRow = rows.get(item.id);
      const sellPrice = item.sell ?? -1;
      const legacyHigh = legacyHighByItemId.get(item.id);
      const previousHigh = [
        Number.isFinite(memRow?.sellHigh) ? memRow.sellHigh : -1,
        Number.isFinite(legacyHigh) ? legacyHigh : -1,
      ].reduce((max, value) => Math.max(max, value), -1);
      const sellPriceHigh = sellPrice < 0
        ? previousHigh
        : previousHigh < 0 ? sellPrice : Math.max(previousHigh, sellPrice);

      const legacyFirstSeen = legacyFirstSeenByItemId.get(item.id);
      const firstSeenCandidates = [
        legacyFirstSeen,
        Number.isFinite(memRow?.first_seen_at) ? memRow.first_seen_at : undefined,
      ].filter(Number.isFinite);
      const firstSeenAt = firstSeenCandidates.length > 0
        ? Math.min(...firstSeenCandidates)
        : memRow ? undefined : now;

      // Delayed/retried Mod payloads (bounded clock skew) may only ever
      // IMPROVE durable aggregates; their price fields are ignored and the
      // document's updatedAt stays at the last real change time.
      const stalePayload = !!memRow && Number.isFinite(memRow.updated_at) && memRow.updated_at > now;
      const base = stalePayload
        ? {
            server,
            itemId: item.id,
            itemName: memRow.name,
            buyPrice: memRow.buy,
            sellPrice: memRow.sell,
            stackPrice: memRow.stackPrice ?? null,
            sellPriceHigh,
            ...(firstSeenAt === undefined ? {} : { firstSeenAt }),
            updatedAt: memRow.updated_at,
          }
        : {
            server,
            itemId: item.id,
            itemName: item.name,
            buyPrice: item.buy ?? -1,
            sellPrice,
            stackPrice: item.stackPrice ?? null,
            sellPriceHigh,
            ...(firstSeenAt === undefined ? {} : { firstSeenAt }),
            updatedAt: now,
          };

      batch.set(pricesCol.doc(priceDocId(server, item.id)), base, { merge: true });
      actuallyWritten.push({ idx: i, base });
    }
    await batch.commit();
  }

  // History records a PRICE timeline, not a poll log: append only the items
  // whose observed values actually changed (or are brand new).
  const historyBatch = db.batch();
  let historyWrites = 0;
  const freshHistoryRows = [];
  for (const { idx } of actuallyWritten) {
    const item = prices[idx];
    const row = {
      server,
      itemId: item.id,
      itemName: item.name,
      buyPrice: item.buy ?? -1,
      sellPrice: item.sell ?? -1,
      stackPrice: item.stackPrice ?? null,
      createdAt: now,
    };
    historyBatch.set(
      historyCol.doc(historyDocId(server, item.id, now, item)),
      row,
      { merge: true }
    );
    freshHistoryRows.push(row);
    historyWrites += 1;
  }
  if (historyWrites > 0) {
    await historyBatch.commit();
    // Mirror the committed points into the in-memory store so chart/stats
    // reads never need Firestore between restarts.
    insertHistoryRows(server, freshHistoryRows);
  }

  // Patch the in-memory store with exactly what was committed — this is what
  // lets getCurrentPrices serve forever without re-scanning Firestore.
  for (const { base } of actuallyWritten) {
    rows.set(base.itemId, {
      id: base.itemId,
      name: base.itemName,
      buy: base.buyPrice,
      sell: base.sellPrice,
      sellHigh: typeof base.sellPriceHigh === 'number' ? base.sellPriceHigh : base.sellPrice,
      stackPrice: base.stackPrice ?? null,
      updated_at: base.updatedAt,
      first_seen_at: Number.isFinite(base.firstSeenAt) ? base.firstSeenAt : null,
    });
  }

  // Mark consulted legacy items as migrated only AFTER everything succeeded,
  // so a failed sync naturally retries its legacy lookup on the next attempt.
  if (needsLegacyIdx.length > 0) {
    const done = legacyMigrationDone.get(server) ?? new Set();
    for (const i of needsLegacyIdx) done.add(prices[i].id);
    legacyMigrationDone.set(server, done);
  }

  scheduleSnapshotSave();

  // History & itemHistory now live in the in-memory store (patched above);
  // only the statsService totalItems wrapper still needs purging so a NEW
  // item shows up promptly.
  cache.deleteKey(`totalItems:${server}`);
}

async function getCurrentPrices(server) {
  // Served entirely from the in-memory authoritative store — the only
  // Firestore read ever charged here is the single load scan after boot.
  const byItem = await ensureCurrentRows(server);
  const rowsOut = [...byItem.values()];
  // Sorted in application code (see NOTE above) rather than .orderBy() to
  // avoid needing a composite index for this simple, small-scale query.
  rowsOut.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
  return rowsOut;
}

async function getItemHistory(server, itemId, limit = 100) {
  // Served from the in-memory history store: zero Firestore reads. The
  // store is newest-first, so the first `limit` matches for this item ARE
  // the newest ones; dedupe keeps the first (newest) occurrence, matching
  // the previous query-then-dedupe behavior.
  const rows = await ensureRecentHistory(server);
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    if (row.itemId !== itemId) continue;
    const key = `${row.itemId}\u0000${row.createdAt}\u0000${row.buyPrice}\u0000${row.sellPrice}\u0000${row.stackPrice ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: row.itemId,
      name: typeof row.itemName === 'string' && row.itemName ? row.itemName : row.itemId,
      buy: row.buyPrice,
      sell: row.sellPrice,
      stackPrice: row.stackPrice ?? null,
      created_at: row.createdAt,
    });
    if (out.length >= limit) break;
  }
  return out;
}

async function getItems(server) {
  // Derived from the already-cached current-prices rows instead of running a
  // second full-collection scan — the {id, name} list is a strict subset of
  // that data, so this costs zero additional Firestore reads.
  const rows = await getCurrentPrices(server);
  return rows.map((row) => ({ id: row.id, name: row.name }));
}

module.exports = {
  applyPriceUpdate,
  getCurrentPrices,
  getItemHistory,
  getItems,
  getRecentHistoryDocs: ensureRecentHistory,
  priceDocId,
};
