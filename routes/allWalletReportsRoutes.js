const express = require('express');
const router = express.Router();
const { protect, authorize, authorizeByPermission } = require('../middleware/authMiddleware');
const {
  getAllWalletReportsTotals,
  getUserWalletReport,
  getAllWalletReportsWithFilters
} = require('../controllers/allWalletReportsController');

// All routes require authentication - SuperAdmin role OR any role with wallet.all permission
// This means any newly created role with wallet.all permission will automatically have access
router.get('/totals', protect, authorizeByPermission('wallet.all', ['SuperAdmin']), getAllWalletReportsTotals);
router.get('/user/:userId', protect, authorizeByPermission('wallet.all', ['SuperAdmin']), getUserWalletReport);
router.get('/', protect, authorizeByPermission('wallet.all', ['SuperAdmin']), getAllWalletReportsWithFilters);

module.exports = router;

