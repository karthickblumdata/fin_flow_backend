const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const { getDashboard, getFinancialData, getDashboardTotals, getDashboardSummary } = require('../controllers/dashboardController');

router.get('/', protect, getDashboard);
router.get('/financial', protect, getFinancialData);
router.get('/totals', protect, getDashboardTotals);
// Dashboard summary - allow all authenticated users, controller handles permission checks
router.get('/summary', protect, getDashboardSummary);

module.exports = router;
