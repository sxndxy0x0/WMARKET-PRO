const express = require('express');
const router = express.Router();

const { getItems } = require('../controllers/itemsController');

router.get('/', getItems);

module.exports = router;
