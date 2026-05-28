const express = require('express');
const mediaController = require('../controllers/mediaController');

const router = express.Router();

router.get('/image', mediaController.proxyImage);
router.get('/product/:idOrSlug/:index?', mediaController.productImage);
router.get('/fallback', mediaController.fallbackImage);

module.exports = router;
