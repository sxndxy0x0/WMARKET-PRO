const express = require('express');
const router = express.Router();

const {
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
} = require('../controllers/watchlistController');
const { requireAuth } = require('../services/userAuth');
const { authLimiter } = require('../services/rateLimit');

router.use(authLimiter);
router.use(requireAuth);

router.get('/', getWatchlist);
router.post('/', addToWatchlist);
router.delete('/:server/:itemId', removeFromWatchlist);

module.exports = router;
