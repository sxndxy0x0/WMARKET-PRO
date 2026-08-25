const express = require('express');
const router = express.Router();

const { me } = require('../controllers/authController');
const { requireAuth } = require('../services/userAuth');
const { authLimiter } = require('../services/rateLimit');

router.get('/me', authLimiter, requireAuth, me);

module.exports = router;
