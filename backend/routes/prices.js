const express = require('express');
const router = express.Router();

const { postPrices, getPrices } = require('../controllers/pricesController');
const { requireApiKey } = require('../services/auth');
const { ingestLimiter } = require('../services/rateLimit');

// Mod -> backend, requires API key
router.post('/', ingestLimiter, requireApiKey, postPrices);

// Public read
router.get('/', getPrices);

module.exports = router;
