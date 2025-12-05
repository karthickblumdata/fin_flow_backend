const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  addAmountToAccount,
  withdrawFromAccount
} = require('../controllers/walletController');

// Allow regular users to add amounts to their own account, SuperAdmin can add to any account
router.post('/add-amount', protect, addAmountToAccount);
router.post('/withdraw', protect, withdrawFromAccount);

module.exports = router;

