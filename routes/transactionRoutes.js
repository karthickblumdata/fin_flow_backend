const express = require('express');
const router = express.Router();
const { protect, authorize, authorizeByPermission, authorizeByAnyPermission } = require('../middleware/authMiddleware');
const {
  createTransaction,
  getTransactions,
  approveTransaction,
  rejectTransaction,
  cancelTransaction,
  flagTransaction,
  resubmitTransaction,
  updateTransaction,
  deleteTransaction,
} = require('../controllers/transactionController');

router.post('/', protect, createTransaction);
router.get('/', protect, getTransactions);
// Transaction management routes - SuperAdmin OR roles with transactions.manage OR wallet.all.transaction.* permission
router.put('/:id', protect, authorizeByAnyPermission(['transactions.manage', 'wallet.all.transaction.edit'], ['SuperAdmin']), updateTransaction);
router.post('/:id/approve', protect, approveTransaction); // Allow receiver to approve if created by SuperAdmin
router.post('/:id/reject', protect, rejectTransaction); // Allow receiver to reject if created by SuperAdmin
router.post('/:id/cancel', protect, cancelTransaction);
router.post('/:id/flag', protect, authorizeByAnyPermission(['transactions.flag', 'wallet.all.transaction.flag'], ['SuperAdmin']), flagTransaction);
router.post('/:id/resubmit', protect, resubmitTransaction); // Allow owner or Admin/SuperAdmin to resubmit
router.delete('/:id', protect, authorizeByAnyPermission(['transactions.manage', 'wallet.all.transaction.remove'], ['SuperAdmin']), deleteTransaction);

module.exports = router;
