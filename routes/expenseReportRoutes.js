const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  createExpenseReport,
  updateExpenseReport,
  deleteExpenseReport,
  getExpensesPaginated
} = require('../controllers/expenseReportController');
const { getExpenseReport, getExpenseSummary } = require('../controllers/reportController');

// Expense report routes
router.post('/', protect, createExpenseReport);
router.put('/:id', protect, updateExpenseReport);
router.delete('/:id', protect, deleteExpenseReport);
router.get('/list', protect, getExpensesPaginated);
router.get('/', protect, getExpenseReport);

// Summary route - accessible at /api/expenses/report/summary
router.get('/summary', protect, getExpenseSummary);

module.exports = router;

