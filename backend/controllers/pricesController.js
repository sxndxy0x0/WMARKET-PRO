const priceService = require('../services/priceService');
const alertsService = require('../services/alertsService');
const { broadcastPriceUpdate } = require('../websocket/hub');
const { isValidFirestoreIdSegment } = require('../services/validation');
const { resolveOrCreate, resolveExisting, canonicalizeServerName } = require('../services/serverIdentity');

/**
 * POST /api/prices
 * Body matches the mod's JSON FORMAT:
 * { server, timestamp, prices: [{ id, name, buy, sell, stackPrice? }, ...] }
 *
 * NOTE: buy/sell can legitimately be -1 (mod's sentinel for "this server
 * doesn't show that price") — that's still a valid number, not an error.
 * stackPrice is optional; older mod configs won't send it.
 */
async function postPrices(req, res, next) {
  const { server, timestamp, prices } = req.body || {};

  if (!server || !Array.isArray(prices) || prices.length === 0 || prices.length > 250) {
    return res.status(400).json({ error: 'server and non-empty prices[] (max 250) are required' });
  }
  // `server` and each item's `id` are encoded into a deterministic,
  // collision-resistant Firestore document ID by services/priceService.js.
  // See
  // services/validation.js for why "/" and friends can't be allowed there.
  // `timestamp` is optional (services/priceService.js falls back to
  // "now" when absent/falsy), but if the mod DOES send one it must be a
  // real Unix-seconds number — a stray string/object here would otherwise
  // flow straight through into Firestore's `createdAt`/`updatedAt` fields
  // untyped, silently breaking every numeric comparison downstream
  // (sorting history, the 24h/7d window math in statsService, and the
  // frontend's relative-time formatting).
  if (timestamp !== undefined && timestamp !== null) {
    const now = Math.floor(Date.now() / 1000);
    const MAX_PAST_SKEW_SECONDS = 7 * 24 * 60 * 60;
    const MAX_FUTURE_SKEW_SECONDS = 5 * 60;
    if (!Number.isInteger(timestamp) || timestamp <= 0 || timestamp < now - MAX_PAST_SKEW_SECONDS || timestamp > now + MAX_FUTURE_SKEW_SECONDS) {
      return res.status(400).json({ error: 'timestamp must be an integer Unix-seconds value within 7 days in the past or 5 minutes in the future' });
    }
  }

  const seenItemIds = new Set();
  for (let i = 0; i < prices.length; i++) {
    const p = prices[i];
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      return res.status(400).json({ error: `invalid price entry at index ${i}` });
    }
    // `typeof x === 'number'` alone lets NaN/Infinity through (both are
    // typeof "number"). That matters here specifically because sell price
    // feeds a running max (services/priceService.js `sellPriceHigh`) —
    // `Math.max(previousHigh, NaN)` is permanently `NaN` from that point
    // on for the item, and it isn't self-healing on a later good sync
    // (NaN poisons every future comparison too). Number.isFinite rejects
    // both NaN and +/-Infinity while still allowing the legitimate -1
    // sentinel.
    const stackPriceOk = p.stackPrice === undefined || Number.isFinite(p.stackPrice);
    if (!p.id || !Number.isFinite(p.buy) || !Number.isFinite(p.sell) || !stackPriceOk) {
      return res.status(400).json({ error: `invalid price entry at index ${i}` });
    }
    if (typeof p.name !== 'string' || p.name.trim().length === 0 || p.name.length > 300) {
      return res.status(400).json({ error: `invalid price name at index ${i}` });
    }
    if (!isValidFirestoreIdSegment(p.id)) {
      return res.status(400).json({ error: `invalid price entry id at index ${i}` });
    }
    if (seenItemIds.has(p.id)) {
      return res.status(400).json({ error: `duplicate item id at index ${i}` });
    }
    seenItemIds.add(p.id);
  }

  const validServer = canonicalizeServerName(server);
  if (!validServer || !isValidFirestoreIdSegment(validServer)) {
    return res.status(400).json({ error: 'server contains invalid characters or is too long' });
  }

  let canonicalServer;
  try {
    canonicalServer = await resolveOrCreate(validServer);
    if (!canonicalServer || !isValidFirestoreIdSegment(canonicalServer)) {
      return res.status(400).json({ error: 'server contains invalid characters or is too long' });
    }
    await priceService.applyPriceUpdate({ server: canonicalServer, timestamp, prices });
    broadcastPriceUpdate({ server: canonicalServer, timestamp, prices });

    // Respond as soon as the price data is durably written — the mod only
    // cares that the sync landed, and a slow Firestore round inside here
    // would otherwise stretch the mod's HTTP timeout for no benefit.
    res.status(201).json({ ok: true, count: prices.length });

    // Check every changed item's sell price against any not-yet-triggered
    // alerts — ONE query for the whole sync (see alertsService for why this
    // used to be one query per item, which was a hidden per-sync read cost
    // unrelated to website traffic). Deliberately OFF the request's critical
    // path (the old comment claimed it didn't block the response, but it was
    // awaited inline): it runs after the response is sent, on this
    // long-lived process, and only when the sync above actually succeeded.
    // Clients still find out via GET /api/alerts. The .catch keeps this
    // background work from ever surfacing as an unhandledRejection; a
    // transient Firestore error here is retried by the next price sync.
    alertsService
      .checkAndTriggerBatch(canonicalServer, prices.map((p) => ({ itemId: p.id, sellPrice: p.sell })))
      .then((triggered) => {
        if (triggered.length > 0) {
          console.log(`[alerts] ${triggered.length} alert(s) triggered for ${canonicalServer}`);
        }
      })
      .catch((err) => {
        console.error('[alerts] check failed after price commit', err);
      });
  } catch (err) {
    next(err);
  }
}

/** GET /api/prices?server=... */
async function getPrices(req, res, next) {
  const requestedServer = req.query.server;
  if (!requestedServer) {
    return res.status(400).json({ error: 'server query param is required' });
  }
  try {
    const server = await resolveExisting(requestedServer);
    if (!server) return res.status(404).json({ error: 'Unknown server' });
    res.json(await priceService.getCurrentPrices(server));
  } catch (err) {
    next(err);
  }
}

module.exports = { postPrices, getPrices };
