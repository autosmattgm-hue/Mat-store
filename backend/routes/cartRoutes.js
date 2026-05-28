const express = require('express');
const cartController = require('../controllers/cartController');
const { optionalAuth, requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/', optionalAuth, cartController.get);
router.post('/', optionalAuth, cartController.upsert);
router.get('/abandoned', requireAuth, requireAdmin, cartController.abandoned);

module.exports = router;
