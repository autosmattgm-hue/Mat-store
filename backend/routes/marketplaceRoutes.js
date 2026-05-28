const express = require('express');
const marketplaceController = require('../controllers/marketplaceController');
const { optionalAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/search', optionalAuth, marketplaceController.search);

module.exports = router;
