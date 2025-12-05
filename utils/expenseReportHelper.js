const Expense = require('../models/expenseModel');
const mongoose = require('mongoose');

/**
 * Map expense status from existing format to report format
 * @param {String} status - Existing status (Pending, Approved, Rejected, Flagged)
 * @returns {String} - Report status (approved, unapproved, flagged)
 */
const mapExpenseStatus = (status) => {
  const statusMap = {
    'Approved': 'approved',
    'Completed': 'approved',
    'Pending': 'unapproved',
    'Rejected': 'unapproved',
    'Flagged': 'flagged'
  };
  return statusMap[status] || 'unapproved';
};

/**
 * Map report status to existing format
 * @param {String} reportStatus - Report status (approved, unapproved, flagged)
 * @returns {String} - Existing status
 */
const mapReportStatusToExpense = (reportStatus) => {
  const statusMap = {
    'approved': 'Approved',
    'unapproved': 'Pending',
    'flagged': 'Flagged'
  };
  return statusMap[reportStatus] || 'Pending';
};

/**
 * Build MongoDB query from filters
 * @param {Object} filters - Filter object with from, to, status, category
 * @returns {Object} - MongoDB query
 */
const buildExpenseQuery = (filters) => {
  const query = {};

  // Date range filter
  if (filters.from || filters.to) {
    query.createdAt = {};
    if (filters.from) {
      const fromDate = new Date(filters.from);
      fromDate.setHours(0, 0, 0, 0);
      query.createdAt.$gte = fromDate;
    }
    if (filters.to) {
      const toDate = new Date(filters.to);
      toDate.setHours(23, 59, 59, 999);
      query.createdAt.$lte = toDate;
    }
  }

  // Status filter - map report status to expense status
  if (filters.status) {
    const expenseStatus = mapReportStatusToExpense(filters.status);
    if (filters.status === 'approved') {
      query.status = { $in: ['Approved', 'Completed'] };
    } else if (filters.status === 'unapproved') {
      query.status = { $in: ['Pending', 'Rejected'] };
    } else if (filters.status === 'flagged') {
      query.status = 'Flagged';
    }
  }

  // Category filter
  if (filters.category) {
    query.category = filters.category;
  }

  return query;
};

/**
 * Build expense report aggregation pipeline
 * @param {Object} filters - Filter object
 * @returns {Array} - Aggregation pipeline stages
 */
const buildExpenseReportAggregation = (filters) => {
  const matchQuery = buildExpenseQuery(filters);

  return [
    // Match stage - filter expenses
    {
      $match: matchQuery
    },
    // Group by status
    {
      $group: {
        _id: '$status',
        amount: { $sum: '$amount' },
        count: { $sum: 1 }
      }
    }
  ];
};

/**
 * Get expense report with aggregations
 * @param {Object} filters - Filter object
 * @returns {Promise<Object>} - Report data
 */
const getExpenseReport = async (filters = {}) => {
  const matchQuery = buildExpenseQuery(filters);

  // Get all expenses matching filters
  const expenses = await Expense.find(matchQuery)
    .sort({ createdAt: -1 })
    .lean();

  // Calculate totals
  let totalAmount = 0;
  let totalCount = 0;
  const byStatus = {
    approved: { amount: 0, count: 0 },
    unapproved: { amount: 0, count: 0 },
    flagged: { amount: 0, count: 0 }
  };
  const byCategoryMap = {};

  expenses.forEach(expense => {
    const amount = expense.amount || 0;
    totalAmount += amount;
    totalCount += 1;

    // Group by status (mapped)
    const reportStatus = mapExpenseStatus(expense.status);
    if (byStatus[reportStatus]) {
      byStatus[reportStatus].amount += amount;
      byStatus[reportStatus].count += 1;
    }

    // Group by category
    const category = expense.category || 'Uncategorized';
    if (!byCategoryMap[category]) {
      byCategoryMap[category] = { amount: 0, count: 0 };
    }
    byCategoryMap[category].amount += amount;
    byCategoryMap[category].count += 1;
  });

  // Convert category map to array
  const byCategory = Object.keys(byCategoryMap).map(category => ({
    category,
    amount: byCategoryMap[category].amount,
    count: byCategoryMap[category].count
  })).sort((a, b) => b.amount - a.amount); // Sort by amount descending

  // Map expense statuses for response
  const mappedExpenses = expenses.map(expense => ({
    _id: expense._id,
    amount: expense.amount,
    description: expense.description || '',
    category: expense.category || '',
    status: mapExpenseStatus(expense.status),
    createdAt: expense.createdAt
  }));

  return {
    totalAmount,
    totalCount,
    byStatus,
    byCategory,
    expenses: mappedExpenses
  };
};

/**
 * Get expenses with cursor-based pagination
 * @param {Object} filters - Filter object
 * @param {String} cursor - MongoDB _id of last item
 * @param {Number} limit - Number of items per page
 * @returns {Promise<Object>} - Paginated expenses
 */
const getExpensesWithCursor = async (filters = {}, cursor = null, limit = 20) => {
  // Validate and clamp limit
  const validLimit = Math.min(Math.max(1, parseInt(limit) || 20), 100);

  const query = buildExpenseQuery(filters);

  // Add cursor for pagination
  if (cursor) {
    try {
      const cursorId = new mongoose.Types.ObjectId(cursor);
      query._id = { $lt: cursorId };
    } catch (error) {
      throw new Error('Invalid cursor format');
    }
  }

  // Fetch one extra to check if there are more
  const expenses = await Expense.find(query)
    .sort({ createdAt: -1, _id: -1 })
    .limit(validLimit + 1)
    .lean();

  const hasMore = expenses.length > validLimit;
  const result = hasMore ? expenses.slice(0, validLimit) : expenses;
  const nextCursor = hasMore && result.length > 0 ? result[result.length - 1]._id.toString() : null;

  // Map expenses
  const mappedExpenses = result.map(expense => ({
    _id: expense._id,
    amount: expense.amount,
    description: expense.description || '',
    category: expense.category || '',
    status: mapExpenseStatus(expense.status),
    createdAt: expense.createdAt
  }));

  return {
    expenses: mappedExpenses,
    pagination: {
      hasMore,
      nextCursor,
      limit: validLimit,
      count: mappedExpenses.length
    }
  };
};

/**
 * Get expense summary for dashboard
 * @returns {Promise<Object>} - Summary data
 */
const getExpenseSummary = async () => {
  const expenses = await Expense.find().lean();

  const summary = {
    approved: { count: 0, amount: 0 },
    unapproved: { count: 0, amount: 0 },
    flagged: { count: 0, amount: 0 },
    total: { count: 0, amount: 0 }
  };

  expenses.forEach(expense => {
    const amount = expense.amount || 0;
    const reportStatus = mapExpenseStatus(expense.status);

    summary.total.count += 1;
    summary.total.amount += amount;

    if (summary[reportStatus]) {
      summary[reportStatus].count += 1;
      summary[reportStatus].amount += amount;
    }
  });

  return summary;
};

module.exports = {
  mapExpenseStatus,
  mapReportStatusToExpense,
  buildExpenseQuery,
  buildExpenseReportAggregation,
  getExpenseReport,
  getExpensesWithCursor,
  getExpenseSummary
};

