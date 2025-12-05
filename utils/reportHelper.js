const Expense = require('../models/expenseModel');
const Transaction = require('../models/transactionModel');
const Collection = require('../models/collectionModel');
const Report = require('../models/reportModel');

/**
 * Build MongoDB query from filter object
 * @param {Object} filters - Filter object
 * @returns {Object} MongoDB query
 */
function buildQueryFromFilters(filters = {}) {
  const query = {};

  // Date range filter
  if (filters.startDate || filters.endDate) {
    query.createdAt = {};
    if (filters.startDate) {
      query.createdAt.$gte = new Date(filters.startDate);
    }
    if (filters.endDate) {
      // Add one day to include the entire end date
      const endDate = new Date(filters.endDate);
      endDate.setHours(23, 59, 59, 999);
      query.createdAt.$lte = endDate;
    }
  }

  // Mode filter
  if (filters.mode && filters.mode !== 'All') {
    query.mode = filters.mode;
  }

  // Status filter
  if (filters.status && filters.status !== 'All') {
    query.status = filters.status;
  }

  // User filter
  if (filters.userId) {
    query.userId = filters.userId;
  }

  // Category filter (for expenses)
  if (filters.category) {
    query.category = filters.category;
  }

  // Purpose filter (for transactions)
  if (filters.purpose) {
    query.purpose = { $regex: filters.purpose, $options: 'i' };
  }

  return query;
}

/**
 * Calculate report summary from query
 * @param {Object} query - MongoDB query
 * @returns {Promise<Object>} Summary object
 */
async function calculateReportSummary(query = {}) {
  try {
    const [expenses, transactions, collections] = await Promise.all([
      Expense.find(query).lean(),
      Transaction.find(query).lean(),
      Collection.find(query).lean()
    ]);

    const totalExpenses = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    const totalTransactions = transactions.reduce((sum, t) => sum + (t.amount || 0), 0);
    const totalCollections = collections.reduce((sum, c) => sum + (c.amount || 0), 0);

    const pendingExpenses = expenses.filter(e => e.status === 'Pending' || e.status === 'Flagged').length;
    const pendingTransactions = transactions.filter(t => t.status === 'Pending' || t.status === 'Flagged').length;
    const pendingCollections = collections.filter(c => c.status === 'Pending' || c.status === 'Flagged').length;

    return {
      totalExpenses,
      totalTransactions,
      totalCollections,
      netFlow: totalCollections - totalExpenses,
      expenseCount: expenses.length,
      transactionCount: transactions.length,
      collectionCount: collections.length,
      totalInflow: totalCollections,
      totalOutflow: totalExpenses + totalTransactions,
      pendingApprovals: pendingExpenses + pendingTransactions + pendingCollections
    };
  } catch (error) {
    console.error('Error calculating report summary:', error);
    return {
      totalExpenses: 0,
      totalTransactions: 0,
      totalCollections: 0,
      netFlow: 0,
      expenseCount: 0,
      transactionCount: 0,
      collectionCount: 0,
      totalInflow: 0,
      totalOutflow: 0,
      pendingApprovals: 0
    };
  }
}

/**
 * Validate report filters
 * @param {Object} filters - Filter object
 * @returns {Object} { valid: Boolean, error: String }
 */
function validateReportFilters(filters = {}) {
  // Validate date range
  if (filters.startDate && filters.endDate) {
    const start = new Date(filters.startDate);
    const end = new Date(filters.endDate);
    if (start > end) {
      return { valid: false, error: 'Start date cannot be after end date' };
    }
  }

  // Validate mode
  if (filters.mode && !['Cash', 'UPI', 'Bank', 'All'].includes(filters.mode)) {
    return { valid: false, error: 'Invalid payment mode' };
  }

  return { valid: true };
}

/**
 * Generate report name from filters
 * @param {Object} filters - Filter object
 * @returns {String} Generated report name
 */
function generateReportName(filters = {}) {
  const parts = [];

  if (filters.startDate && filters.endDate) {
    const start = new Date(filters.startDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    const end = new Date(filters.endDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    if (start === end) {
      parts.push(start);
    } else {
      parts.push(`${start} - ${end}`);
    }
  }

  if (filters.mode && filters.mode !== 'All') {
    parts.push(filters.mode);
  }

  if (filters.status && filters.status !== 'All') {
    parts.push(filters.status);
  }

  const name = parts.length > 0 
    ? `Expense Report - ${parts.join(' ')}`
    : 'Expense Report';

  return name;
}

/**
 * Check if an expense matches report filters
 * @param {Object} expense - Expense object
 * @param {Object} filters - Report filters
 * @returns {Boolean} True if expense matches filters
 */
function expenseMatchesFilters(expense, filters = {}) {
  // Date range check
  if (filters.startDate || filters.endDate) {
    const expenseDate = new Date(expense.createdAt);
    if (filters.startDate) {
      const startDate = new Date(filters.startDate);
      if (expenseDate < startDate) return false;
    }
    if (filters.endDate) {
      const endDate = new Date(filters.endDate);
      endDate.setHours(23, 59, 59, 999);
      if (expenseDate > endDate) return false;
    }
  }

  // Mode filter
  if (filters.mode && filters.mode !== 'All' && expense.mode !== filters.mode) {
    return false;
  }

  // Status filter - check if expense status matches
  if (filters.status && filters.status !== 'All') {
    const expenseStatus = expense.status;
    const filterStatus = filters.status;

    // If filter is "Approved", only match approved expenses
    if (filterStatus === 'Approved' && expenseStatus !== 'Approved' && expenseStatus !== 'Completed') {
      return false;
    }

    // If filter is "Pending", only match pending expenses
    if (filterStatus === 'Pending' && expenseStatus !== 'Pending') {
      return false;
    }

    // If filter is "Unapproved", don't match approved expenses
    if (filterStatus === 'Unapproved' && (expenseStatus === 'Approved' || expenseStatus === 'Completed')) {
      return false;
    }

    // For other specific status filters, do exact match
    if (filterStatus !== 'Approved' && filterStatus !== 'Pending' && filterStatus !== 'Unapproved') {
      if (expenseStatus !== filterStatus) {
        return false;
      }
    }
  }

  // User filter
  const expenseUserId = typeof expense.userId === 'object' ? expense.userId._id.toString() : expense.userId.toString();
  if (filters.userId && expenseUserId !== filters.userId.toString()) {
    return false;
  }

  // Category filter
  if (filters.category && expense.category !== filters.category) {
    return false;
  }

  return true;
}

/**
 * Update saved reports when an expense is approved
 * @param {Object} expense - Approved expense object
 * @returns {Promise<void>}
 */
async function updateSavedReportsForExpense(expense) {
  try {
    // Get all saved reports
    const savedReports = await Report.find({}).lean();

    for (const report of savedReports) {
      // Check if expense matches this report's filters
      if (expenseMatchesFilters(expense, report.filters)) {
        // Check if expense ID is not already in snapshot
        const expenseId = expense._id.toString();
        const isAlreadyInSnapshot = report.snapshot?.expenses?.some(
          id => id.toString() === expenseId
        );

        if (!isAlreadyInSnapshot) {
          // Update the report
          const reportDoc = await Report.findById(report._id);
          
          // Add expense ID to snapshot
          if (!reportDoc.snapshot) {
            reportDoc.snapshot = { expenses: [], transactions: [], collections: [] };
          }
          if (!reportDoc.snapshot.expenses) {
            reportDoc.snapshot.expenses = [];
          }
          reportDoc.snapshot.expenses.push(expense._id);

          // Update summary
          reportDoc.summary.expenseCount = (reportDoc.summary.expenseCount || 0) + 1;
          reportDoc.summary.totalExpenses = (reportDoc.summary.totalExpenses || 0) + (expense.amount || 0);
          reportDoc.summary.netFlow = (reportDoc.summary.totalCollections || 0) - reportDoc.summary.totalExpenses;
          reportDoc.summary.totalOutflow = (reportDoc.summary.totalExpenses || 0) + (reportDoc.summary.totalTransactions || 0);

          // If fullData is included, add expense to fullData
          if (reportDoc.includeFullData && reportDoc.fullData) {
            const expenseWithUser = await Expense.findById(expense._id)
              .populate('userId', 'name email')
              .populate('createdBy', 'name email')
              .lean();
            if (expenseWithUser) {
              if (!reportDoc.fullData.expenses) {
                reportDoc.fullData.expenses = [];
              }
              reportDoc.fullData.expenses.push(expenseWithUser);
            }
          }

          await reportDoc.save();
          console.log(`✅ Updated saved report "${report.reportName}" with approved expense ${expense._id}`);
        }
      }
    }
  } catch (error) {
    console.error('Error updating saved reports for expense:', error);
    // Don't throw error - we don't want to break expense approval if report update fails
  }
}

module.exports = {
  buildQueryFromFilters,
  calculateReportSummary,
  validateReportFilters,
  generateReportName,
  expenseMatchesFilters,
  updateSavedReportsForExpense
};

