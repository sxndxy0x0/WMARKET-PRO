const { timingSafeEqual } = require('crypto');

/**
 * Simple bearer-token auth for the mod -> backend direction.
 * Compares against the comma-separated API_KEYS env var.
 *
 * Current design uses a shared API-key list for Mod ingestion. Per-server
 * keys can be introduced later without changing the server identity rules.
 */

// Constant-time string compare — a plain `===`/`.includes()` check bails
// out at the first mismatched byte, so response time leaks how many
// leading characters of a guess were correct. Irrelevant for a single
// local comparison, but this runs on every request to a network-exposed
// endpoint, so it's worth closing off. Both sides must be equal length
// for timingSafeEqual, so unequal-length inputs are rejected up front
// (this length check itself doesn't leak the key, only its length, which
// isn't secret).
function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function requireApiKey(req, res, next) {
  const configured = (process.env.API_KEYS || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  const isValid = Boolean(token) && configured.some((key) => safeEqual(token, key));
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }

  next();
}

module.exports = { requireApiKey };
