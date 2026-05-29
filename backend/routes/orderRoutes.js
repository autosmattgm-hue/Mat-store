const express = require('express');
const orderController = require('../controllers/orderController');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/paypal/config', orderController.paypalConfig);
router.post('/paypal/create', requireAuth, orderController.createPaypalOrder);
router.post('/paypal/capture', requireAuth, orderController.capturePaypalOrder);
router.get('/track', orderController.track);
router.post('/', requireAuth, orderController.create);
router.get('/my', requireAuth, orderController.myOrders);
router.get('/', requireAuth, requireAdmin, orderController.list);
router.patch('/:id', requireAuth, requireAdmin, orderController.update);

module.exports = router;
