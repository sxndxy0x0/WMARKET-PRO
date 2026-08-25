const priceService = require('../services/priceService');
const { resolveExisting } = require('../services/serverIdentity');
const { isValidFirestoreIdSegment } = require('../services/validation');

/** GET /api/history?server=...&item=...&limit=100 */
async function getHistory(req, res, next) {
  const { server: requestedServer, item } = req.query;
  const rawLimit = Number(req.query.limit);
  const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 100;

  if (!requestedServer || !item || !isValidFirestoreIdSegment(item)) {
    return res.status(400).json({ error: 'valid server and item query params are required' });
  }

  try {
    const server = await resolveExisting(requestedServer);
    if (!server) return res.status(404).json({ error: 'Unknown server' });
    res.json(await priceService.getItemHistory(server, item, limit));
  } catch (err) {
    next(err);
  }
}

module.exports = { getHistory };
