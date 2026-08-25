const statsService = require('../services/statsService');
const { resolveExisting } = require('../services/serverIdentity');

async function getStats(req, res, next) {
  const requestedServer = req.query.server;
  if (!requestedServer) return res.status(400).json({ error: 'server query param is required' });
  try {
    const server = await resolveExisting(requestedServer);
    if (!server) return res.status(404).json({ error: 'Unknown server' });
    res.json(await statsService.getSummary(server));
  } catch (err) { next(err); }
}

async function getTimeseries(req, res, next) {
  const requestedServer = req.query.server;
  if (!requestedServer) return res.status(400).json({ error: 'server query param is required' });
  try {
    const server = await resolveExisting(requestedServer);
    if (!server) return res.status(404).json({ error: 'Unknown server' });
    res.json(await statsService.getTimeseries(server));
  } catch (err) { next(err); }
}

module.exports = { getStats, getTimeseries };
