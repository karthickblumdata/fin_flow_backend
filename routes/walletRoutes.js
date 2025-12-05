const express = require('express');
const router = express.Router();
const { protect, authorize, authorizeByPermission } = require('../middleware/authMiddleware');
const {
  getWallet,
  getAllWallets,
  addAmount,
  withdrawAmount,
  getWalletReport,
  getSelfWalletReport,
  getWalletTransactionById
} = require('../controllers/walletController');

router.get('/', protect, getWallet);
// Allow SuperAdmin role OR any role with wallet.all permission to view all wallets
// This means any newly created role with wallet.all permission will automatically have access
router.get('/all', protect, authorizeByPermission('wallet.all', ['SuperAdmin']), getAllWallets);
// Keep old endpoint for backward compatibility (deprecated) - SuperAdmin OR roles with wallet.all permission
router.get('/report', protect, authorizeByPermission('wallet.all', ['SuperAdmin']), getWalletReport);
// Self wallet report - any authenticated user can access their own wallet report
router.get('/report/self', protect, getSelfWalletReport);
router.get('/transactions/:id', protect, getWalletTransactionById);
router.post('/add', protect, addAmount);
router.post('/withdraw', protect, withdrawAmount);

module.exports = router;
