const express = require('express');
const router = express.Router();
const { getServers } = require('../controllers/serversController');

router.get('/', getServers);

module.exports = router;
