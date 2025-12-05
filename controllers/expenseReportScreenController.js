const {
  getExpenseReportData,
  getExpenseReportSummary
} = require('../utils/expenseReportScreenHelper');

// @desc    Get expense report data for expense report screen
// @route   GET /api/expense-report-screen/data
// @access  Private
exports.getExpenseReportData = async (req, res) => {
  try {
    const { from, to, status, category, userId, cursor, limit } = req.query;

    // Build filters object
    const filters = {};
    if (from) filters.from = from;
    if (to) filters.to = to;
    if (status) filters.status = status;
    if (category) filters.category = category;
    if (userId) filters.userId = userId;

    // Get expense report data with pagination
    const result = await getExpenseReportData(filters, cursor, limit);

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error getting expense report data:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get expense report data'
    });
  }
};

// @desc    Get expense report summary only
// @route   GET /api/expense-report-screen/summary
// @access  Private
exports.getExpenseReportSummary = async (req, res) => {
  try {
    const { from, to, status, category, userId } = req.query;

    // Build filters object
    const filters = {};
    if (from) filters.from = from;
    if (to) filters.to = to;
    if (status) filters.status = status;
    if (category) filters.category = category;
    if (userId) filters.userId = userId;

    // Get expense report summary
    const summary = await getExpenseReportSummary(filters);

    res.status(200).json({
      success: true,
      summary
    });
  } catch (error) {
    console.error('Error getting expense report summary:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get expense report summary'
    });
  }
};

