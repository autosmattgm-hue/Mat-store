const express = require('express');
const importerController = require('../controllers/importerController');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth, requireAdmin);
router.get('/marketplaces', importerController.marketplaces);
router.post('/preview', importerController.preview);
router.post('/import', importerController.importProduct);

module.exports = router;
