const priceService = require('../services/priceService');
const { resolveExisting } = require('../services/serverIdentity');

/** GET /api/items?server=... */
async function getItems(req, res, next) {
  const requestedServer = req.query.server;
  if (!requestedServer) {
    return res.status(400).json({ error: 'server query param is required' });
  }
  try {
    const server = await resolveExisting(requestedServer);
    if (!server) return res.status(404).json({ error: 'Unknown server' });
    res.json(await priceService.getItems(server));
  } catch (err) {
    next(err);
  }
}

module.exports = { getItems };
