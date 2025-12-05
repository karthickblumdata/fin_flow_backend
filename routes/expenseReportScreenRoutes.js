const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getExpenseReportData,
  getExpenseReportSummary
} = require('../controllers/expenseReportScreenController');

// Expense report screen routes
router.get('/data', protect, getExpenseReportData);
router.get('/summary', protect, getExpenseReportSummary);

module.exports = router;

