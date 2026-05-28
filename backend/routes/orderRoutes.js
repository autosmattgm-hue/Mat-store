const express = require('express');
const orderController = require('../controllers/orderController');
const { optionalAuth, requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.post('/', optionalAuth, orderController.create);
router.get('/my', requireAuth, orderController.myOrders);
router.get('/', requireAuth, requireAdmin, orderController.list);
router.patch('/:id', requireAuth, requireAdmin, orderController.update);

module.exports = router;
