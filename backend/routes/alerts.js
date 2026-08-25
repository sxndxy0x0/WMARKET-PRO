const express = require('express');
const router = express.Router();

const { getAlerts, createAlert, deleteAlert } = require('../controllers/alertsController');
const { requireAuth } = require('../services/userAuth');
const { authLimiter } = require('../services/rateLimit');

router.use(authLimiter);
router.use(requireAuth);

router.get('/', getAlerts);
router.post('/', createAlert);
router.delete('/:id', deleteAlert);

module.exports = router;
