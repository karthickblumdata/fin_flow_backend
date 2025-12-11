const mongoose = require('mongoose');
const Collection = require('../models/collectionModel');
const Transaction = require('../models/transactionModel');
const Expense = require('../models/expenseModel');

const escapeRegex = (value = '') =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toObjectIdArray = (values = []) =>
  values
    .map((value) => {
      if (mongoose.Types.ObjectId.isValid(value)) {
        return new mongoose.Types.ObjectId(value);
      }
      return null;
    })
    .filter(Boolean);

const buildSearchQuery = (fields, keyword) => {
  if (!keyword) {
    return null;
  }

  const expression = new RegExp(escapeRegex(keyword), 'i');
  return {
    $or: fields.map((field) => ({ [field]: expression })),
  };
};

const fetchPendingData = async ({
  type,
  status,
  mode,
  search,
  ids,
  limit,
  skip,
  user, // Add user parameter for filtering (optional)
}) => {
  const objectIds = Array.isArray(ids) ? toObjectIdArray(ids) : [];
  const resolvedLimit = Number.isInteger(limit) && limit > 0 ? limit : undefined;
  const resolvedSkip = Number.isInteger(skip) && skip >= 0 ? skip : undefined;

  // For Smart Approvals: Always include all three types (Transactions, Collections, Expenses)
  // When type is null (forced for Smart Approvals), include all types
  // This ensures all pending items of all types appear in Smart Approvals
  const includeCollections = !type || type === 'Collections' || type === 'All';
  const includeTransactions = !type || type === 'Transactions' || type === 'All';
  const includeExpenses = !type || type === 'Expenses' || type === 'All';

  // Check if user is SuperAdmin or admin@examples.com - can see all pending items
  const isSuperAdmin = user?.role === 'SuperAdmin';
  const isProtectedUser = user?.email === 'admin@examples.com';
  const canSeeAll = isSuperAdmin || isProtectedUser;

  const collectionFilter = {};
  const transactionFilter = {};
  const expenseFilter = {};
  
  // For Smart Approvals: SuperAdmin and admin@examples.com see all pending items from all users
  // No user filtering is applied - all pending items are shown to SuperAdmin
  // Always fetch all three types for Smart Approvals regardless of type filter

  console.log(`[Pending Approvals] fetchPendingData - status parameter: ${status}, type: ${typeof status}`);
  
  if (status) {
    // Use case-insensitive regex matching for status to handle different cases (Flagged, flagged, etc.)
    const statusRegex = new RegExp(`^${escapeRegex(status)}$`, 'i');
    console.log(`[Pending Approvals] Setting status filter - status: ${status}, regex: ${statusRegex}`);
    collectionFilter.status = statusRegex;
    transactionFilter.status = statusRegex;
    expenseFilter.status = statusRegex;
  } else {
    console.log(`[Pending Approvals] ⚠️ No status provided - status filter will not be applied`);
  }

  if (mode) {
    collectionFilter.mode = mode;
    transactionFilter.mode = mode;
    expenseFilter.mode = mode;
  }

  if (objectIds.length) {
    const idFilter = { $in: objectIds };
    if (includeCollections) {
      collectionFilter._id = idFilter;
    }
    if (includeTransactions) {
      transactionFilter._id = idFilter;
    }
    if (includeExpenses) {
      expenseFilter._id = idFilter;
    }
  }

  if (search) {
    const collectionSearch = buildSearchQuery(
      ['customerName', 'notes', 'voucherNumber', 'mode'],
      search,
    );
    const transactionSearch = buildSearchQuery(
      ['purpose', 'mode'],
      search,
    );
    const expenseSearch = buildSearchQuery(
      ['description', 'category', 'mode'],
      search,
    );

    if (collectionSearch) {
      Object.assign(collectionFilter, collectionSearch);
    }
    if (transactionSearch) {
      Object.assign(transactionFilter, transactionSearch);
    }
    if (expenseSearch) {
      Object.assign(expenseFilter, expenseSearch);
    }
  }

  let collectionQuery = null;
  if (includeCollections) {
    collectionQuery = Collection.find(collectionFilter)
      .populate('collectedBy', 'name email role')
      .populate('from', 'name email role')
      .populate('assignedReceiver', 'name email role')
      .populate('paymentModeId', 'modeName autoPay assignedReceiver description isActive')
      .populate('approvedBy', 'name email role')
      .sort({ createdAt: -1 })
      .lean();

    if (resolvedSkip) {
      collectionQuery = collectionQuery.skip(resolvedSkip);
    }
    if (resolvedLimit) {
      collectionQuery = collectionQuery.limit(resolvedLimit);
    }
  }

  let transactionQuery = null;
  if (includeTransactions) {
    // Log the filter in a way that shows RegExp properly
    const filterForLog = {
      ...transactionFilter,
      status: transactionFilter.status ? transactionFilter.status.toString() : transactionFilter.status
    };
    console.log(`[Pending Approvals] Transaction filter:`, JSON.stringify(filterForLog, null, 2));
    console.log(`[Pending Approvals] Transaction filter status (raw):`, transactionFilter.status);
    console.log(`[Pending Approvals] Transaction filter keys:`, Object.keys(transactionFilter));
    
    // Also check if there are any Pending transactions in the database (for debugging)
    const allPendingCount = await Transaction.countDocuments({ status: 'Pending' });
    console.log(`[Pending Approvals] Total transactions with status 'Pending' in database: ${allPendingCount}`);
    
    transactionQuery = Transaction.find(transactionFilter)
      .populate('initiatedBy', 'name email role')
      .populate('receiver', 'name email role')
      .populate('sender', 'name email role')
      .populate('paymentModeId', 'modeName autoPay assignedReceiver description isActive')
      .populate('approvedBy', 'name email role')
      .sort({ createdAt: -1 })
      .lean();

    if (resolvedSkip) {
      transactionQuery = transactionQuery.skip(resolvedSkip);
    }
    if (resolvedLimit) {
      transactionQuery = transactionQuery.limit(resolvedLimit);
    }
  }

  let expenseQuery = null;
  if (includeExpenses) {
    expenseQuery = Expense.find(expenseFilter)
      .populate('createdBy', 'name email role')
      .populate('userId', 'name email role')
      .populate('paymentModeId', 'modeName autoPay assignedReceiver description isActive')
      .populate('approvedBy', 'name email role')
      .sort({ createdAt: -1 })
      .lean();

    if (resolvedSkip) {
      expenseQuery = expenseQuery.skip(resolvedSkip);
    }
    if (resolvedLimit) {
      expenseQuery = expenseQuery.limit(resolvedLimit);
    }
  }

  const [collections, transactions, expenses] = await Promise.all([
    includeCollections ? collectionQuery.exec() : [],
    includeTransactions ? transactionQuery.exec() : [],
    includeExpenses ? expenseQuery.exec() : [],
  ]);

  // Debug logging for transactions
  if (includeTransactions) {
    console.log(`[Pending Approvals] Transaction query results: ${transactions.length} transactions found`);
    if (transactions.length > 0) {
      console.log(`[Pending Approvals] Transaction statuses:`, transactions.map(tx => ({ id: tx._id, status: tx.status })));
    } else {
      console.log(`[Pending Approvals] ⚠️ No transactions found with filter:`, JSON.stringify(transactionFilter, null, 2));
    }
  }

  return {
    collections,
    transactions,
    expenses,
  };
};

exports.getPendingApprovals = async (req, res) => {
  try {
    const {
      type,
      status,
      mode,
      search,
      page,
      limit,
    } = req.query;

    const resolvedLimit = limit ? parseInt(limit, 10) : undefined;
    const resolvedPage = page ? parseInt(page, 10) : undefined;
    const skip = resolvedLimit && resolvedPage
      ? (resolvedPage - 1) * resolvedLimit
      : undefined;

    // For Smart Approvals: Default to 'Pending' status if not provided
    // Smart Approvals should only show items with status 'Pending'
    const resolvedStatus = status || 'Pending';
    
    console.log(`[Pending Approvals] getPendingApprovals - status from query: ${status}, resolvedStatus: ${resolvedStatus}`);

    // For Smart Approvals: Always fetch all three types (Transactions, Collections, Expenses)
    // Ignore the type filter - Smart Approvals should show all pending items of all types
    // All users with smart_approvals permission should see all pending items
    const data = await fetchPendingData({
      type: null, // Force all types for Smart Approvals - always show Transactions, Collections, and Expenses
      status: resolvedStatus, // Use 'Pending' as default for Smart Approvals
      mode,
      search,
      limit: resolvedLimit,
      skip,
      user: req.user, // Pass user for SuperAdmin filtering
    });

    // Debug logging for Smart Approvals
    console.log('\n📋 [SMART APPROVALS] API Response:');
    console.log(`   User: ${req.user?.email || 'Unknown'} (Role: ${req.user?.role || 'Unknown'})`);
    console.log(`   Status Filter: ${resolvedStatus} (requested: ${status || 'none'})`);
    console.log(`   Collections: ${data.collections.length}`);
    console.log(`   Transactions: ${data.transactions.length}`);
    console.log(`   Expenses: ${data.expenses.length}`);
    console.log(`   Total Items: ${data.collections.length + data.transactions.length + data.expenses.length}`);
    console.log('=====================================\n');

    res.status(200).json({
      success: true,
      data,
      meta: {
        type: type || 'All',
        status: resolvedStatus,
        mode: mode || 'All',
        page: resolvedPage || 1,
        limit: resolvedLimit,
        total: {
          collections: data.collections.length,
          transactions: data.transactions.length,
          expenses: data.expenses.length,
        },
      },
    });
  } catch (error) {
    console.error('❌ [SMART APPROVALS] Error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.exportPendingApprovals = async (req, res) => {
  try {
    const filters = req.body?.filters || {};
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];

    // For Smart Approvals export: Always fetch all three types (Transactions, Collections, Expenses)
    // Ignore the type filter - Smart Approvals should show all pending items of all types
    // Pass user info so SuperAdmin can see all pending items
    const data = await fetchPendingData({
      type: null, // Force all types for Smart Approvals export - always show Transactions, Collections, and Expenses
      status: filters.status,
      mode: filters.mode,
      ids,
      user: req.user, // Pass user for SuperAdmin filtering
    });

    const totalCount =
      data.collections.length + data.transactions.length + data.expenses.length;

    res.status(200).json({
      success: true,
      message: totalCount
        ? `Prepared export for ${totalCount} record${totalCount === 1 ? '' : 's'}`
        : 'No records matched the export filters',
      data,
      count: totalCount,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

