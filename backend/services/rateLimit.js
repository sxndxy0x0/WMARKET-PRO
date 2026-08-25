const rateLimit = require('express-rate-limit');

/**
 * Centralized rate limiters. `express-rate-limit` was already a declared
 * dependency but wasn't wired into any route — every endpoint (including
 * unauthenticated ones behind Firestore reads, and the mod's price-ingest
 * endpoint) had no request cap at all. That's a real gap for a backend
 * whose whole caching strategy (services/cache.js) exists specifically to
 * stay under Firestore's free-tier read quota: caching only helps once a
 * request reaches the app; nothing stopped a client from being sent that
 * many requests in the first place.
 *
 * Standard headers (RateLimit-*) are enabled so well-behaved clients can
 * see their remaining quota; legacy X-RateLimit-* headers are disabled.
 */

const jsonRateLimitResponse = (req, res) => {
  res.status(429).json({ error: 'Too many requests, please try again later.' });
};

// Generous default for read-heavy public endpoints (prices/stats/items/
// history) — these are already protected from hammering Firestore itself
// by services/cache.js; this cap exists to bound raw request volume/CPU.
// 240/min: the web dashboard legitimately loads 30-50 price-history
// sparklines per visit (paced client-side to ~85/min) plus prices/stats/
// registry traffic on the same IP — 120 was low enough that ordinary
// browsing tripped 429 storms while scrolling.
const generalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 240,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitResponse,
});

// Stricter cap for authenticated mutation endpoints (watchlist/alerts
// writes, /api/auth/me token verification) — these bypass services/cache.js
// entirely and each hit Firestore and/or Firebase Auth directly.
const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitResponse,
});

// Tightest cap for the mod -> backend price-ingest endpoint. Protected by
// requireApiKey already, but a leaked/misconfigured key (e.g. a mod stuck
// in a retry loop) shouldn't be able to write unbounded batches — normal
// sync cadence is on the order of once per GUI refresh, far under this.
const ingestLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitResponse,
});

module.exports = { generalLimiter, authLimiter, ingestLimiter };
