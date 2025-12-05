const express = require('express');
const router = express.Router();
const { protect, authorize, authorizeByPermission } = require('../middleware/authMiddleware');
const {
  createPaymentMode,
  getPaymentModes,
  updatePaymentMode,
  deletePaymentMode
} = require('../controllers/paymentModeController');

// Logging middleware for debugging
router.use((req, res, next) => {
  console.log(`[PaymentMode Routes] ${req.method} ${req.path}`);
  console.log('Headers:', {
    authorization: req.headers.authorization ? 'Present' : 'Missing',
    'content-type': req.headers['content-type']
  });
  next();
});

// Test endpoint without auth to debug
router.get('/test', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Payment modes route is working',
    timestamp: new Date().toISOString()
  });
});

// Payment mode routes - SuperAdmin OR roles with payment_modes.manage permission
router.post('/', protect, authorizeByPermission('payment_modes.manage', ['SuperAdmin']), createPaymentMode);
router.get('/', protect, getPaymentModes);
router.put('/:id', protect, authorizeByPermission('payment_modes.manage', ['SuperAdmin']), updatePaymentMode);
router.delete('/:id', protect, authorizeByPermission('payment_modes.manage', ['SuperAdmin']), deletePaymentMode);

module.exports = router;
