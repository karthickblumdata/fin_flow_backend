const express = require('express');
const router = express.Router();
const { login, forgotPassword, resetPassword, logout, refreshCurrentUserPermissions } = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/logout', protect, logout); // Protected route - requires valid token
router.get('/me/permissions', protect, refreshCurrentUserPermissions); // Refresh current user permissions

module.exports = router;
