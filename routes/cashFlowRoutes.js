const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  createCashFlow,
  getCashFlow,
  updateCashFlow,
  deleteCashFlow
} = require('../controllers/cashFlowController');

// Cash flow routes
router.post('/', protect, createCashFlow);
router.get('/', protect, getCashFlow);
router.put('/:id', protect, updateCashFlow);
router.delete('/:id', protect, deleteCashFlow);

module.exports = router;

