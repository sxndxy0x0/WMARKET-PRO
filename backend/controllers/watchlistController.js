const watchlistService = require('../services/watchlistService');
const { isValidFirestoreIdSegment } = require('../services/validation');
const { resolveExisting } = require('../services/serverIdentity');

async function getWatchlist(req, res, next) {
  try {
    res.json(await watchlistService.list(req.user.id));
  } catch (err) {
    next(err);
  }
}

async function addToWatchlist(req, res, next) {
  const { server, itemId } = req.body || {};
  if (!server || !itemId) {
    return res.status(400).json({ error: 'server and itemId are required' });
  }
  if (!isValidFirestoreIdSegment(server) || !isValidFirestoreIdSegment(itemId)) {
    return res.status(400).json({ error: 'server/itemId contain invalid characters or are too long' });
  }
  try {
    const canonicalServer = await resolveExisting(server);
    if (!canonicalServer) return res.status(404).json({ error: 'Unknown server' });
    await watchlistService.add(req.user.id, canonicalServer, itemId, 100);
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

async function removeFromWatchlist(req, res, next) {
  const { server, itemId } = req.params;
  if (!isValidFirestoreIdSegment(server) || !isValidFirestoreIdSegment(itemId)) {
    // Nothing legitimate could have this shape, so there's nothing to
    // delete — respond the same as a normal "already gone" no-op instead
    // of a 400, since this is just a malformed/malicious URL, not a
    // client mistake worth surfacing differently.
    return res.json({ ok: true });
  }
  try {
    const canonicalServer = await resolveExisting(server);
    if (!canonicalServer) return res.json({ ok: true });
    await watchlistService.remove(req.user.id, canonicalServer, itemId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { getWatchlist, addToWatchlist, removeFromWatchlist };
