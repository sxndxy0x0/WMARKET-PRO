const express = require('express');
const router = express.Router();

const { getStats, getTimeseries } = require('../controllers/statsController');

router.get('/', getStats);
router.get('/timeseries', getTimeseries);

module.exports = router;
