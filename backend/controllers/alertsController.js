const alertsService = require('../services/alertsService');
const { isValidFirestoreIdSegment } = require('../services/validation');
const { resolveExisting } = require('../services/serverIdentity');

const VALID_TYPES = new Set(['above', 'below']);

async function getAlerts(req, res, next) {
  try {
    res.json(await alertsService.list(req.user.id));
  } catch (err) {
    next(err);
  }
}

async function createAlert(req, res, next) {
  const { server, itemId, itemName, thresholdType, thresholdValue } = req.body || {};

  if (!server || !itemId || !itemName) {
    return res.status(400).json({ error: 'server, itemId, and itemName are required' });
  }
  if (!VALID_TYPES.has(thresholdType)) {
    return res.status(400).json({ error: `thresholdType must be one of: ${[...VALID_TYPES].join(', ')}` });
  }
  // Number.isFinite (not `typeof ... === 'number'`) rejects NaN/Infinity —
  // both are typeof "number" but would otherwise create an alert that's
  // either dead on arrival (NaN never satisfies >= or <=) or fires
  // immediately on the very next price sync (`below: Infinity` matches
  // any sell price), neither of which is a state a real user threshold
  // should be able to reach.
  if (!Number.isFinite(thresholdValue) || thresholdValue < 0) {
    return res.status(400).json({ error: 'thresholdValue must be a non-negative finite number' });
  }

  try {
    const canonicalServer = await resolveExisting(server);
    if (!canonicalServer) return res.status(404).json({ error: 'Unknown server' });
    await alertsService.create(req.user.id, { server: canonicalServer, itemId, itemName, thresholdType, thresholdValue }, 50);
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

async function deleteAlert(req, res, next) {
  if (!isValidFirestoreIdSegment(req.params.id)) {
    return res.json({ ok: true });
  }
  try {
    await alertsService.remove(req.user.id, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { getAlerts, createAlert, deleteAlert };
