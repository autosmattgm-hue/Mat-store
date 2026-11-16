const express = require('express');
const rateLimit = require('express-rate-limit');
const aiAgentController = require('../controllers/aiAgentController');
const { optionalAuth, requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

const agentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 80,
  standardHeaders: true,
  legacyHeaders: false
});

router.post('/agent', agentLimiter, optionalAuth, aiAgentController.chat);
router.post('/report', agentLimiter, requireAuth, requireAdmin, aiAgentController.report);

module.exports = router;
