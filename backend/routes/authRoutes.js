const express = require('express');
const authController = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/refresh', authController.refresh);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);
router.get('/currencies', authController.currencies);
router.get('/me', requireAuth, authController.me);
router.patch('/profile', requireAuth, authController.updateProfile);
router.post('/addresses', requireAuth, authController.saveAddress);
router.post('/wishlist/:productId', requireAuth, authController.toggleWishlist);
router.post('/logout', requireAuth, authController.logout);

module.exports = router;
