const Collection = require('../models/collectionModel');
const Transaction = require('../models/transactionModel');
const Expense = require('../models/expenseModel');

// Helper function to format currency
const formatCurrency = (amount) => {
  if (amount == null || isNaN(amount)) return '₹0';
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `₹${formatted}`;
};

// Transform Collection to Smart Approval Item
const transformCollection = (collection) => {
  const paymentMode = collection.paymentModeId || {};
  const isSystematicEntry = collection.isSystematicEntry || 
    (paymentMode.autoPay === true && collection.mode !== 'Cash');
  const isAutoPay = paymentMode.autoPay === true || false;
  const isFlagged = collection.status === 'Flagged';

  return {
    id: collection._id.toString(),
    type: 'Collections',
    title: collection.customerName || 'Collection',
    subtitle: `Voucher: ${collection.voucherNumber || 'N/A'}`,
    amount: collection.amount || 0,
    formattedAmount: formatCurrency(collection.amount || 0),
    date: collection.createdAt,
    status: collection.status || 'Pending',
    mode: collection.mode || 'Cash',
    isSystematicEntry: isSystematicEntry,
    isAutoPay: isAutoPay,
    flagged: isFlagged,
    details: {
      customerName: collection.customerName || 'N/A',
      voucherNumber: collection.voucherNumber || 'N/A',
      paymentModeName: paymentMode.modeName || 'N/A',
      collectedBy: collection.collectedBy ? {
        id: collection.collectedBy._id?.toString() || collection.collectedBy.toString(),
        name: collection.collectedBy.name || 'N/A',
        email: collection.collectedBy.email || 'N/A',
        role: collection.collectedBy.role || 'N/A',
      } : null,
      assignedReceiver: collection.assignedReceiver ? {
        id: collection.assignedReceiver._id?.toString() || collection.assignedReceiver.toString(),
        name: collection.assignedReceiver.name || 'N/A',
        email: collection.assignedReceiver.email || 'N/A',
        role: collection.assignedReceiver.role || 'N/A',
      } : null,
      notes: collection.notes || '',
      proofUrl: collection.proofUrl || null,
    },
    metadata: {
      createdAt: collection.createdAt,
      updatedAt: collection.updatedAt,
      systemTransactionId: collection.systemTransactionId?.toString() || null,
      approvedBy: collection.approvedBy ? {
        id: collection.approvedBy._id?.toString() || collection.approvedBy.toString(),
        name: collection.approvedBy.name || 'N/A',
        email: collection.approvedBy.email || 'N/A',
      } : null,
      approvedAt: collection.approvedAt || null,
    },
    raw: collection, // Include raw data for reference
  };
};

// Transform Transaction to Smart Approval Item
const transformTransaction = (transaction) => {
  const sender = transaction.sender || {};
  const receiver = transaction.receiver || {};
  const senderName = sender.name || 'Unknown';
  const receiverName = receiver.name || 'Unknown';
  const isSystematicEntry = transaction.isSystemTransaction === true || transaction.isAutoPay === true;
  const isAutoPay = transaction.isAutoPay === true || false;
  const isFlagged = transaction.status === 'Flagged';

  return {
    id: transaction._id.toString(),
    type: 'Transactions',
    title: transaction.purpose || 'Transaction',
    subtitle: `${senderName} → ${receiverName}`,
    amount: transaction.amount || 0,
    formattedAmount: formatCurrency(transaction.amount || 0),
    date: transaction.createdAt,
    status: transaction.status || 'Pending',
    mode: transaction.mode || 'Cash',
    isSystematicEntry: isSystematicEntry,
    isAutoPay: isAutoPay,
    flagged: isFlagged,
    details: {
      sender: sender.name || 'N/A',
      senderId: sender._id?.toString() || sender.toString() || null,
      senderEmail: sender.email || 'N/A',
      receiver: receiver.name || 'N/A',
      receiverId: receiver._id?.toString() || receiver.toString() || null,
      receiverEmail: receiver.email || 'N/A',
      purpose: transaction.purpose || 'N/A',
      proofUrl: transaction.proofUrl || null,
    },
    metadata: {
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
      initiatedBy: transaction.initiatedBy ? {
        id: transaction.initiatedBy._id?.toString() || transaction.initiatedBy.toString(),
        name: transaction.initiatedBy.name || 'N/A',
        email: transaction.initiatedBy.email || 'N/A',
        role: transaction.initiatedBy.role || 'N/A',
      } : null,
      approvedBy: transaction.approvedBy ? {
        id: transaction.approvedBy._id?.toString() || transaction.approvedBy.toString(),
        name: transaction.approvedBy.name || 'N/A',
        email: transaction.approvedBy.email || 'N/A',
      } : null,
      approvedAt: transaction.approvedAt || null,
      linkedCollectionId: transaction.linkedCollectionId?.toString() || null,
    },
    raw: transaction, // Include raw data for reference
  };
};

// Transform Expense to Smart Approval Item
const transformExpense = (expense) => {
  const user = expense.userId || expense.createdBy || {};
  const isFlagged = expense.status === 'Flagged';

  return {
    id: expense._id.toString(),
    type: 'Expenses',
    title: expense.description || expense.category || 'Expense',
    subtitle: `Category: ${expense.category || 'N/A'}`,
    amount: expense.amount || 0,
    formattedAmount: formatCurrency(expense.amount || 0),
    date: expense.createdAt,
    status: expense.status || 'Pending',
    mode: expense.mode || 'Cash',
    isSystematicEntry: false, // Expenses don't have auto pay
    isAutoPay: false,
    flagged: isFlagged,
    details: {
      category: expense.category || 'N/A',
      description: expense.description || 'N/A',
      user: user.name || 'N/A',
      userId: user._id?.toString() || user.toString() || null,
      userEmail: user.email || 'N/A',
      proofUrl: expense.proofUrl || null,
    },
    metadata: {
      createdAt: expense.createdAt,
      updatedAt: expense.updatedAt,
      createdBy: expense.createdBy ? {
        id: expense.createdBy._id?.toString() || expense.createdBy.toString(),
        name: expense.createdBy.name || 'N/A',
        email: expense.createdBy.email || 'N/A',
        role: expense.createdBy.role || 'N/A',
      } : null,
      approvedBy: expense.approvedBy ? {
        id: expense.approvedBy._id?.toString() || expense.approvedBy.toString(),
        name: expense.approvedBy.name || 'N/A',
        email: expense.approvedBy.email || 'N/A',
      } : null,
      approvedAt: expense.approvedAt || null,
    },
    raw: expense, // Include raw data for reference
  };
};

// Build filter query for collections
const buildCollectionFilter = (filters, user) => {
  const filter = {};

  // Status filter
  if (filters.status && filters.status !== 'All') {
    filter.status = filters.status;
  } else if (!filters.status) {
    filter.status = 'Pending'; // Default to Pending
  }

  // Mode filter
  if (filters.mode && filters.mode !== 'All') {
    filter.mode = filters.mode;
  }

  // Flagged filter
  if (filters.flagged === true) {
    filter.status = 'Flagged';
  } else if (filters.flagged === false && filters.status === 'Pending') {
    filter.status = 'Pending';
  }

  // Systematic entry filter
  if (filters.systematic === true) {
    filter.isSystematicEntry = true;
  }

  // Date range filter
  if (filters.startDate || filters.endDate) {
    filter.createdAt = {};
    if (filters.startDate) {
      filter.createdAt.$gte = new Date(filters.startDate);
    }
    if (filters.endDate) {
      const endDate = new Date(filters.endDate);
      endDate.setHours(23, 59, 59, 999); // Include entire end date
      filter.createdAt.$lte = endDate;
    }
  }

  // User-based filtering (if not SuperAdmin)
  const isSuperAdmin = user?.role === 'SuperAdmin';
  const isProtectedUser = user?.email === 'admin@examples.com';
  const canSeeAll = isSuperAdmin || isProtectedUser;

  // Build $and conditions if we have multiple OR conditions
  const andConditions = [];

  // Search filter
  if (filters.search) {
    const searchRegex = new RegExp(filters.search, 'i');
    andConditions.push({
      $or: [
        { customerName: searchRegex },
        { voucherNumber: searchRegex },
        { notes: searchRegex },
        { mode: searchRegex },
      ],
    });
  }

  // User-based filtering (if not SuperAdmin)
  if (!canSeeAll) {
    andConditions.push({
      $or: [
        { collectedBy: user._id },
        { assignedReceiver: user._id },
      ],
    });
  }

  // Combine with $and if we have multiple conditions
  if (andConditions.length > 0) {
    if (andConditions.length === 1) {
      Object.assign(filter, andConditions[0]);
    } else {
      filter.$and = andConditions;
    }
  }

  return filter;
};

// Build filter query for transactions
const buildTransactionFilter = (filters, user) => {
  const filter = {};

  // Status filter
  if (filters.status && filters.status !== 'All') {
    filter.status = filters.status;
  } else if (!filters.status) {
    filter.status = 'Pending'; // Default to Pending
  }

  // Mode filter
  if (filters.mode && filters.mode !== 'All') {
    filter.mode = filters.mode;
  }

  // Flagged filter
  if (filters.flagged === true) {
    filter.status = 'Flagged';
  } else if (filters.flagged === false && filters.status === 'Pending') {
    filter.status = 'Pending';
  }

  // Date range filter
  if (filters.startDate || filters.endDate) {
    filter.createdAt = {};
    if (filters.startDate) {
      filter.createdAt.$gte = new Date(filters.startDate);
    }
    if (filters.endDate) {
      const endDate = new Date(filters.endDate);
      endDate.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = endDate;
    }
  }

  // User-based filtering (if not SuperAdmin)
  const isSuperAdmin = user?.role === 'SuperAdmin';
  const isProtectedUser = user?.email === 'admin@examples.com';
  const canSeeAll = isSuperAdmin || isProtectedUser;

  // Build $and conditions if we have multiple OR conditions
  const andConditions = [];

  // Systematic entry filter
  if (filters.systematic === true) {
    andConditions.push({
      $or: [
        { isSystemTransaction: true },
        { isAutoPay: true },
      ],
    });
  }

  // Search filter
  if (filters.search) {
    const searchRegex = new RegExp(filters.search, 'i');
    andConditions.push({
      $or: [
        { purpose: searchRegex },
        { mode: searchRegex },
      ],
    });
  }

  // User-based filtering (if not SuperAdmin)
  if (!canSeeAll) {
    andConditions.push({
      $or: [
        { initiatedBy: user._id },
        { sender: user._id },
        { receiver: user._id },
      ],
    });
  }

  // Combine with $and if we have multiple conditions
  if (andConditions.length > 0) {
    if (andConditions.length === 1) {
      Object.assign(filter, andConditions[0]);
    } else {
      filter.$and = andConditions;
    }
  }

  return filter;
};

// Build filter query for expenses
const buildExpenseFilter = (filters, user) => {
  const filter = {};

  // Status filter
  if (filters.status && filters.status !== 'All') {
    filter.status = filters.status;
  } else if (!filters.status) {
    filter.status = 'Pending'; // Default to Pending
  }

  // Mode filter
  if (filters.mode && filters.mode !== 'All') {
    filter.mode = filters.mode;
  }

  // Flagged filter
  if (filters.flagged === true) {
    filter.status = 'Flagged';
  } else if (filters.flagged === false && filters.status === 'Pending') {
    filter.status = 'Pending';
  }

  // Date range filter
  if (filters.startDate || filters.endDate) {
    filter.createdAt = {};
    if (filters.startDate) {
      filter.createdAt.$gte = new Date(filters.startDate);
    }
    if (filters.endDate) {
      const endDate = new Date(filters.endDate);
      endDate.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = endDate;
    }
  }

  // User-based filtering (if not SuperAdmin)
  const isSuperAdmin = user?.role === 'SuperAdmin';
  const isProtectedUser = user?.email === 'admin@examples.com';
  const canSeeAll = isSuperAdmin || isProtectedUser;

  // Build $and conditions if we have multiple OR conditions
  const andConditions = [];

  // Search filter
  if (filters.search) {
    const searchRegex = new RegExp(filters.search, 'i');
    andConditions.push({
      $or: [
        { description: searchRegex },
        { category: searchRegex },
        { mode: searchRegex },
      ],
    });
  }

  // User-based filtering (if not SuperAdmin)
  if (!canSeeAll) {
    andConditions.push({
      $or: [
        { userId: user._id },
        { createdBy: user._id },
      ],
    });
  }

  // Combine with $and if we have multiple conditions
  if (andConditions.length > 0) {
    if (andConditions.length === 1) {
      Object.assign(filter, andConditions[0]);
    } else {
      filter.$and = andConditions;
    }
  }

  return filter;
};

// Main endpoint: Get Smart Approvals
// @route   GET /api/smart-approvals
// @access  Private
// @description Returns unified pending approvals for Collections, Expenses, and Transactions
exports.getSmartApprovals = async (req, res) => {
  try {
    // Parse query parameters
    const {
      status,
      type,
      mode,
      flagged,
      systematic,
      search,
      startDate,
      endDate,
      page = 1,
      limit = 50,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    // Validate and parse filters
    const filters = {
      status: status || 'Pending',
      type: type || 'All',
      mode: mode || 'All',
      flagged: flagged === 'true' ? true : flagged === 'false' ? false : null,
      systematic: systematic === 'true' ? true : systematic === 'false' ? false : null,
      search: search || null,
      startDate: startDate || null,
      endDate: endDate || null,
    };

    // Validate pagination
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    // Determine which types to include
    const includeCollections = filters.type === 'All' || filters.type === 'Collections';
    const includeTransactions = filters.type === 'All' || filters.type === 'Transactions';
    const includeExpenses = filters.type === 'All' || filters.type === 'Expenses';

    // Build queries
    const queries = [];

    if (includeCollections) {
      const collectionFilter = buildCollectionFilter(filters, req.user);
      queries.push(
        Collection.find(collectionFilter)
          .populate('collectedBy', 'name email role')
          .populate('assignedReceiver', 'name email role')
          .populate('paymentModeId', 'modeName autoPay assignedReceiver description isActive')
          .populate('approvedBy', 'name email role')
          .sort({ createdAt: -1 })
          .lean()
      );
    }

    if (includeTransactions) {
      const transactionFilter = buildTransactionFilter(filters, req.user);
      queries.push(
        Transaction.find(transactionFilter)
          .populate('initiatedBy', 'name email role')
          .populate('receiver', 'name email role')
          .populate('sender', 'name email role')
          .populate('approvedBy', 'name email role')
          .sort({ createdAt: -1 })
          .lean()
      );
    }

    if (includeExpenses) {
      const expenseFilter = buildExpenseFilter(filters, req.user);
      queries.push(
        Expense.find(expenseFilter)
          .populate('createdBy', 'name email role')
          .populate('userId', 'name email role')
          .populate('approvedBy', 'name email role')
          .sort({ createdAt: -1 })
          .lean()
      );
    }

    // Execute queries in parallel
    const results = await Promise.all(queries);

    // Transform results
    let allItems = [];
    let collections = [];
    let transactions = [];
    let expenses = [];

    if (includeCollections && results[0]) {
      collections = results[0].map(transformCollection);
      allItems = [...allItems, ...collections];
    }

    let transactionIndex = includeCollections ? 1 : 0;
    if (includeTransactions && results[transactionIndex]) {
      transactions = results[transactionIndex].map(transformTransaction);
      allItems = [...allItems, ...transactions];
    }

    let expenseIndex = (includeCollections ? 1 : 0) + (includeTransactions ? 1 : 0);
    if (includeExpenses && results[expenseIndex]) {
      expenses = results[expenseIndex].map(transformExpense);
      allItems = [...allItems, ...expenses];
    }

    // Sort all items
    const sortField = sortBy || 'createdAt';
    const sortDirection = sortOrder === 'asc' ? 1 : -1;

    allItems.sort((a, b) => {
      let aValue = a[sortField];
      let bValue = b[sortField];

      // Handle date sorting
      if (sortField === 'date' || sortField === 'createdAt') {
        aValue = new Date(a.date || a.metadata?.createdAt || 0);
        bValue = new Date(b.date || b.metadata?.createdAt || 0);
      }

      // Handle numeric sorting
      if (sortField === 'amount') {
        aValue = a.amount || 0;
        bValue = b.amount || 0;
      }

      // Handle string sorting
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortDirection * aValue.localeCompare(bValue);
      }

      // Default comparison
      if (aValue < bValue) return -1 * sortDirection;
      if (aValue > bValue) return 1 * sortDirection;
      return 0;
    });

    // Calculate summary statistics
    const total = allItems.length;
    const systematicEntries = allItems.filter(item => item.isSystematicEntry).length;
    const flaggedCount = allItems.filter(item => item.flagged).length;

    // Apply pagination
    const totalPages = Math.ceil(total / limitNum);
    const paginatedItems = allItems.slice(skip, skip + limitNum);

    // Return response
    res.status(200).json({
      success: true,
      data: paginatedItems,
      summary: {
        total: total,
        collections: collections.length,
        transactions: transactions.length,
        expenses: expenses.length,
        systematicEntries: systematicEntries,
        flagged: flaggedCount,
      },
      meta: {
        page: pageNum,
        limit: limitNum,
        total: total,
        totalPages: totalPages,
        filters: filters,
      },
    });
  } catch (error) {
    console.error('Error in getSmartApprovals:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch smart approvals',
    });
  }
};

