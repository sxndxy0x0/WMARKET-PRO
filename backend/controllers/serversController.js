const serverIdentity = require('../services/serverIdentity');

async function getServers(req, res, next) {
  try {
    const servers = await serverIdentity.listServers();
    res.set('Cache-Control', 'public, max-age=15, stale-while-revalidate=30');
    res.json({ servers: servers.map((name) => ({ name })) });
  } catch (err) {
    next(err);
  }
}

module.exports = { getServers };
