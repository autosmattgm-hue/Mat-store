const express = require('express');
const adminController = require('../controllers/adminController');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth, requireAdmin);
router.get('/dashboard', adminController.dashboard);
router.get('/customers', adminController.customers);
router.get('/settings', adminController.settings);
router.patch('/settings/pricing', adminController.updatePricing);
router.post('/inventory/sync', adminController.inventorySync);
router.get('/seo/audit', adminController.seoAudit);
router.get('/images/audit', adminController.imageAudit);
router.post('/products/cleanup-duplicates', adminController.cleanupDuplicates);
router.post('/products/repair-pricing', adminController.repairPricing);
router.post('/products/repair-images', adminController.repairImages);

module.exports = router;
