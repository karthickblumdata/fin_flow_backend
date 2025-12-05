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
 * Build MongoDB query from filters for expense report screen
 * @param {Object} filters - Filter object with from, to, status, category, userId
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
  if (filters.status && filters.status !== 'All') {
    if (filters.status === 'approved') {
      query.status = { $in: ['Approved', 'Completed'] };
    } else if (filters.status === 'unapproved') {
      query.status = { $in: ['Pending', 'Rejected'] };
    } else if (filters.status === 'flagged') {
      query.status = 'Flagged';
    }
  }

  // Category filter
  if (filters.category && filters.category !== 'All') {
    query.category = filters.category;
  }

  // User filter (userId or createdBy)
  if (filters.userId) {
    try {
      query.userId = new mongoose.Types.ObjectId(filters.userId);
    } catch (error) {
      throw new Error('Invalid userId format');
    }
  }

  return query;
};

/**
 * Format expense for API response
 * @param {Object} expense - Expense document (populated or lean)
 * @returns {Object} - Formatted expense
 */
const formatExpenseForResponse = (expense) => {
  const formatted = {
    _id: expense._id.toString(),
    amount: expense.amount || 0,
    description: expense.description || '',
    category: expense.category || '',
    status: mapExpenseStatus(expense.status),
    mode: expense.mode || 'Cash',
    proofUrl: expense.proofUrl || null,
    flagReason: expense.flagReason || null,
    createdAt: expense.createdAt,
    updatedAt: expense.updatedAt
  };

  // Add user information if populated
  if (expense.userId && typeof expense.userId === 'object') {
    formatted.userId = {
      _id: expense.userId._id.toString(),
      name: expense.userId.name || '',
      email: expense.userId.email || ''
    };
  } else if (expense.userId) {
    formatted.userId = {
      _id: expense.userId.toString()
    };
  }

  // Add creator information if populated
  if (expense.createdBy && typeof expense.createdBy === 'object') {
    formatted.createdBy = {
      _id: expense.createdBy._id.toString(),
      name: expense.createdBy.name || ''
    };
  } else if (expense.createdBy) {
    formatted.createdBy = {
      _id: expense.createdBy.toString()
    };
  }

  // Add approver information if populated
  if (expense.approvedBy && typeof expense.approvedBy === 'object') {
    formatted.approvedBy = {
      _id: expense.approvedBy._id.toString(),
      name: expense.approvedBy.name || ''
    };
  } else if (expense.approvedBy) {
    formatted.approvedBy = {
      _id: expense.approvedBy.toString()
    };
  }

  if (expense.approvedAt) {
    formatted.approvedAt = expense.approvedAt;
  }

  return formatted;
};

/**
 * Get expense report data with pagination and populated user data
 * @param {Object} filters - Filter object
 * @param {String} cursor - MongoDB _id of last item
 * @param {Number} limit - Number of items per page
 * @returns {Promise<Object>} - Paginated expense data with summary
 */
const getExpenseReportData = async (filters = {}, cursor = null, limit = 20) => {
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

  // Fetch expenses with population
  const expenses = await Expense.find(query)
    .populate('userId', 'name email')
    .populate('createdBy', 'name')
    .populate('approvedBy', 'name')
    .sort({ createdAt: -1, _id: -1 })
    .limit(validLimit + 1)
    .lean();

  const hasMore = expenses.length > validLimit;
  const result = hasMore ? expenses.slice(0, validLimit) : expenses;
  
  // Get next cursor from last item
  let nextCursor = null;
  if (hasMore && result.length > 0) {
    const lastItem = result[result.length - 1];
    nextCursor = lastItem._id.toString();
  }

  // Format expenses for response
  const formattedExpenses = result.map(expense => formatExpenseForResponse(expense));

  // Calculate summary from ALL matching expenses (not just paginated)
  const summaryQuery = buildExpenseQuery(filters);
  const allExpenses = await Expense.find(summaryQuery).lean();

  let totalAmount = 0;
  let totalCount = 0;
  const byStatus = {
    approved: { amount: 0, count: 0 },
    unapproved: { amount: 0, count: 0 },
    flagged: { amount: 0, count: 0 }
  };
  const byCategoryMap = {};

  allExpenses.forEach(expense => {
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

  // Convert category map to array and sort by amount descending
  const byCategory = Object.keys(byCategoryMap).map(category => ({
    category,
    amount: byCategoryMap[category].amount,
    count: byCategoryMap[category].count
  })).sort((a, b) => b.amount - a.amount);

  return {
    expenses: formattedExpenses,
    summary: {
      totalAmount,
      totalCount,
      byStatus,
      byCategory
    },
    pagination: {
      hasMore,
      nextCursor,
      limit: validLimit,
      count: formattedExpenses.length
    }
  };
};

/**
 * Get expense report summary only (without expense list)
 * @param {Object} filters - Filter object
 * @returns {Promise<Object>} - Summary data
 */
const getExpenseReportSummary = async (filters = {}) => {
  const query = buildExpenseQuery(filters);

  const expenses = await Expense.find(query).lean();

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

  // Convert category map to array and sort by amount descending
  const byCategory = Object.keys(byCategoryMap).map(category => ({
    category,
    amount: byCategoryMap[category].amount,
    count: byCategoryMap[category].count
  })).sort((a, b) => b.amount - a.amount);

  return {
    totalAmount,
    totalCount,
    byStatus,
    byCategory
  };
};

module.exports = {
  mapExpenseStatus,
  buildExpenseQuery,
  formatExpenseForResponse,
  getExpenseReportData,
  getExpenseReportSummary
};

