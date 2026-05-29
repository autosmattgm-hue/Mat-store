const express = require('express');
const productController = require('../controllers/productController');
const { requireAuth, optionalAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/suggestions', optionalAuth, productController.suggestions);
router.get('/', optionalAuth, productController.list);
router.post('/', requireAuth, requireAdmin, productController.create);
router.patch('/bulk/markup', requireAuth, requireAdmin, productController.bulkMarkup);
router.get('/admin/low-stock', requireAuth, requireAdmin, productController.lowStock);
router.get('/:id/reviews', optionalAuth, productController.reviews);
router.post('/:id/reviews', optionalAuth, productController.createReview);
router.get('/:idOrSlug', optionalAuth, productController.get);
router.put('/:id', requireAuth, requireAdmin, productController.update);
router.delete('/:id', requireAuth, requireAdmin, productController.remove);

module.exports = router;
