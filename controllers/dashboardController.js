const mongoose = require('mongoose');
const Transaction = require('../models/transactionModel');
const Collection = require('../models/collectionModel');
const Expense = require('../models/expenseModel');
const Wallet = require('../models/walletModel');
const User = require('../models/userModel');
const AuditLog = require('../models/auditLogModel');
const WalletTransaction = require('../models/walletTransactionModel');

// @desc    Get dashboard data
// @route   GET /api/dashboard
// @access  Private
exports.getDashboard = async (req, res) => {
  try {
    const userRole = req.user.role;
    const userId = req.user._id;

    let dashboard = {};

    if (userRole === 'SuperAdmin') {
      // SuperAdmin dashboard
      const totalUsers = await User.countDocuments();
      const totalTransactions = await Transaction.countDocuments();
      const totalCollections = await Collection.countDocuments();
      const totalExpenses = await Expense.countDocuments();

      const pendingTransactions = await Transaction.countDocuments({ status: 'Pending' });
      const pendingCollections = await Collection.countDocuments({ status: 'Pending' });
      const pendingExpenses = await Expense.countDocuments({ status: 'Pending' });

      const allWallets = await Wallet.find();
      const totalBalance = allWallets.reduce((sum, wallet) => sum + wallet.totalBalance, 0);

      // Get recent activity (last 20 audit logs)
      const recentActivity = await AuditLog.find()
        .populate('userId', 'name email role')
        .sort({ createdAt: -1 })
        .limit(20);

      // Get recent transactions (last 5)
      const recentTransactions = await Transaction.find()
        .populate('sender', 'name email')
        .populate('receiver', 'name email')
        .populate('initiatedBy', 'name email')
        .sort({ createdAt: -1 })
        .limit(5);

      // Get recent expenses (last 5)
      const recentExpenses = await Expense.find()
        .populate('userId', 'name email')
        .populate('createdBy', 'name email')
        .sort({ createdAt: -1 })
        .limit(5);

      dashboard = {
        totalUsers,
        totalTransactions,
        totalCollections,
        totalExpenses,
        pendingTransactions,
        pendingCollections,
        pendingExpenses,
        totalBalance,
        recentActivity: recentActivity.map(log => ({
          id: log._id,
          type: log.entityType,
          action: log.actionType,
          actionText: log.action,
          user: log.userId ? {
            id: log.userId._id,
            name: log.userId.name,
            email: log.userId.email,
            role: log.userId.role
          } : null,
          entityId: log.entityId,
          timestamp: log.createdAt,
          notes: log.notes
        })),
        recentTransactions: recentTransactions.map(tx => ({
          id: tx._id,
          date: tx.createdAt,
          sender: tx.sender ? {
            id: tx.sender._id,
            name: tx.sender.name,
            email: tx.sender.email
          } : null,
          receiver: tx.receiver ? {
            id: tx.receiver._id,
            name: tx.receiver.name,
            email: tx.receiver.email
          } : null,
          initiatedBy: tx.initiatedBy ? {
            id: tx.initiatedBy._id,
            name: tx.initiatedBy.name,
            email: tx.initiatedBy.email
          } : null,
          amount: tx.amount,
          mode: tx.mode,
          purpose: tx.purpose,
          status: tx.status,
          createdAt: tx.createdAt
        })),
        recentExpenses: recentExpenses.map(exp => ({
          id: exp._id,
          date: exp.createdAt,
          userId: exp.userId ? {
            id: exp.userId._id,
            name: exp.userId.name,
            email: exp.userId.email
          } : null,
          category: exp.category,
          amount: exp.amount,
          mode: exp.mode,
          description: exp.description,
          status: exp.status,
          createdAt: exp.createdAt
        }))
      };
    } else {
      // Dynamic role dashboard (non-SuperAdmin users)
      const userWallet = await Wallet.findOne({ userId });
      const totalBalance = userWallet ? userWallet.totalBalance : 0;

      // Check if user has Smart Approvals permission
      let hasSmartApprovalsPermission = false;
      try {
        const Role = require('../models/roleModel');
        const role = await Role.findOne({ roleName: userRole });
        let allPermissions = [];
        
        if (role && role.permissionIds && role.permissionIds.length > 0) {
          allPermissions = [...role.permissionIds];
        }
        
        const userSpecificPermissions = req.user.userSpecificPermissions || [];
        allPermissions = [...new Set([...allPermissions, ...userSpecificPermissions])];
        
        // Check if user has smart_approvals permission (parent or child)
        hasSmartApprovalsPermission = allPermissions.some(permission => {
          if (permission === 'smart_approvals' ||
              permission === 'smart_approvals.transaction.view' ||
              permission === 'smart_approvals.collection.view' ||
              permission === 'smart_approvals.expenses.view' ||
              permission.startsWith('smart_approvals.')) {
            return true;
          }
          if (permission === '*') {
            return true;
          }
          return false;
        });
      } catch (error) {
        console.error('Error checking Smart Approvals permission:', error);
      }

      const myTransactions = await Transaction.countDocuments({
        $or: [
          { sender: userId },
          { receiver: userId },
          { initiatedBy: userId }
        ]
      });

      const myCollections = await Collection.countDocuments({
        $or: [
          { collectedBy: userId },
          { assignedReceiver: userId }
        ]
      });

      const myExpenses = await Expense.countDocuments({ userId });

      // For pending counts: If user has Smart Approvals permission, show ALL pending items
      // Otherwise, show only their own pending items
      let pendingMyCollections, pendingMyTransactions, pendingMyExpenses;
      
      if (hasSmartApprovalsPermission) {
        // User has Smart Approvals permission - show all pending items
        pendingMyCollections = await Collection.countDocuments({ status: 'Pending' });
        pendingMyTransactions = await Transaction.countDocuments({ status: 'Pending' });
        pendingMyExpenses = await Expense.countDocuments({ status: 'Pending' });
      } else {
        // Regular user - show only their own pending items
        pendingMyCollections = await Collection.countDocuments({
          $or: [
            { collectedBy: userId },
            { assignedReceiver: userId }
          ],
          status: 'Pending'
        });
        pendingMyTransactions = await Transaction.countDocuments({
          $or: [
            { sender: userId },
            { receiver: userId },
            { initiatedBy: userId }
          ],
          status: 'Pending'
        });
        pendingMyExpenses = await Expense.countDocuments({
          userId,
          status: 'Pending'
        });
      }

      // Get recent transactions for staff (last 5)
      const recentTransactions = await Transaction.find({
        $or: [
          { sender: userId },
          { receiver: userId },
          { initiatedBy: userId }
        ]
      })
        .populate('sender', 'name email')
        .populate('receiver', 'name email')
        .populate('initiatedBy', 'name email')
        .sort({ createdAt: -1 })
        .limit(5);

      // Get recent expenses for staff (last 5)
      const recentExpenses = await Expense.find({ userId })
        .populate('userId', 'name email')
        .populate('createdBy', 'name email')
        .sort({ createdAt: -1 })
        .limit(5);

      dashboard = {
        totalBalance,
        myTransactions,
        myCollections,
        myExpenses,
        // For Smart Approvals: Use same field names as SuperAdmin for consistency
        pendingCollections: pendingMyCollections,
        pendingTransactions: pendingMyTransactions,
        pendingExpenses: pendingMyExpenses,
        // Keep old field names for backwards compatibility
        pendingMyCollections,
        pendingMyTransactions,
        pendingMyExpenses,
        recentTransactions: recentTransactions.map(tx => ({
          id: tx._id,
          date: tx.createdAt,
          sender: tx.sender ? {
            id: tx.sender._id,
            name: tx.sender.name,
            email: tx.sender.email
          } : null,
          receiver: tx.receiver ? {
            id: tx.receiver._id,
            name: tx.receiver.name,
            email: tx.receiver.email
          } : null,
          initiatedBy: tx.initiatedBy ? {
            id: tx.initiatedBy._id,
            name: tx.initiatedBy.name,
            email: tx.initiatedBy.email
          } : null,
          amount: tx.amount,
          mode: tx.mode,
          purpose: tx.purpose,
          status: tx.status,
          createdAt: tx.createdAt
        })),
        recentExpenses: recentExpenses.map(exp => ({
          id: exp._id,
          date: exp.createdAt,
          userId: exp.userId ? {
            id: exp.userId._id,
            name: exp.userId.name,
            email: exp.userId.email
          } : null,
          category: exp.category,
          amount: exp.amount,
          mode: exp.mode,
          description: exp.description,
          status: exp.status,
          createdAt: exp.createdAt
        }))
      };
    }

    res.status(200).json({
      success: true,
      dashboard
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get financial data (combined expenses, transactions, collections)
// @route   GET /api/dashboard/financial
// @access  Private (All authenticated users - data filtered by role)
exports.getFinancialData = async (req, res) => {
  try {
    const userRole = req.user.role;
    const userId = req.user._id;
    
    console.log(`[Dashboard] getFinancialData - User Role: ${userRole}, User ID: ${userId}`);
    
    // Allow all authenticated users by default
    // Only check for explicit permission if needed (for backward compatibility)
    // All roles are automatically allowed - no need to maintain a list
    // This ensures newly created roles work automatically

    // Query parameters for filtering
    const { 
      type,           // 'Expenses', 'Transactions', 'Collections', or null for all
      status,         // 'Approved', 'Unapproved', 'Verified', 'Accountant', or null for all
      mode,           // 'Cash', 'UPI', 'Bank', or null for all
      startDate,      // ISO date string
      endDate         // ISO date string
    } = req.query;

    // Build filter objects
    const expenseFilter = {};
    const transactionFilter = {};
    const collectionFilter = {};

    // Date filters
    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) {
        dateFilter.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999); // Include entire end date
        dateFilter.createdAt.$lte = end;
      }
    }

    // Status filters
    if (status) {
      if (status === 'Approved' || status === 'Verified') {
        expenseFilter.status = { $in: ['Approved', 'Completed'] };
        transactionFilter.status = { $in: ['Approved', 'Completed'] };
        collectionFilter.status = { $in: ['Approved', 'Verified'] };
      } else if (status === 'Unapproved') {
        expenseFilter.status = { $nin: ['Approved', 'Completed'] };
        transactionFilter.status = { $nin: ['Approved', 'Completed'] };
        collectionFilter.status = { $nin: ['Approved', 'Verified'] };
      } else if (status === 'Accountant') {
        collectionFilter.status = { $in: ['Accountant', 'Pending'] };
      }
    }

    // Mode filters
    if (mode) {
      expenseFilter.mode = mode;
      transactionFilter.mode = mode;
      collectionFilter.mode = mode;
    }

    // User-specific filtering for Sales/Staff users (only show their own data)
    // SuperAdmin can see all data, Admin/Sales/Staff see only their own
    if (userRole !== 'SuperAdmin') {
      // Filter expenses - only show expenses for this user
      expenseFilter.userId = userId;
      
      // Filter transactions - show transactions where user is sender or receiver
      transactionFilter.$or = [
        { sender: userId },
        { receiver: userId }
      ];
      
      // Filter collections - show collections where user is collector or assigned receiver
      collectionFilter.$or = [
        { collectedBy: userId },
        { assignedReceiver: userId }
      ];
    }

    // Combine date filters
    Object.assign(expenseFilter, dateFilter);
    Object.assign(transactionFilter, dateFilter);
    Object.assign(collectionFilter, dateFilter);

    // Fetch data based on type filter
    let expenses = [];
    let transactions = [];
    let collections = [];

    if (!type || type === 'Expenses') {
      expenses = await Expense.find(expenseFilter)
        .populate('userId', 'name email')
        .populate('createdBy', 'name email')
        .sort({ createdAt: -1 });
    }

    if (!type || type === 'Transactions') {
      transactions = await Transaction.find(transactionFilter)
        .populate('sender', 'name email')
        .populate('receiver', 'name email')
        .populate('initiatedBy', 'name email')
        .sort({ createdAt: -1 });
    }

    if (!type || type === 'Collections') {
      collections = await Collection.find(collectionFilter)
        .populate('collectedBy', 'name email')
        .populate('from', 'name email')
        .populate('assignedReceiver', 'name email')
        .sort({ createdAt: -1 });
    }

    // Transform expenses
    const transformedExpenses = expenses.map(exp => ({
      id: exp._id,
      type: 'Expenses',
      date: exp.createdAt,
      createdAt: exp.createdAt,
      userId: exp.userId ? {
        id: exp.userId._id,
        name: exp.userId.name,
        email: exp.userId.email
      } : null,
      from: exp.userId ? exp.userId.name : 'Unknown',
      to: '-',
      category: exp.category,
      amount: exp.amount,
      mode: exp.mode,
      description: exp.description || '',
      status: exp.status,
      createdBy: exp.createdBy ? {
        id: exp.createdBy._id,
        name: exp.createdBy.name,
        email: exp.createdBy.email
      } : null
    }));

    // Transform transactions
    const transformedTransactions = transactions.map(tx => ({
      id: tx._id,
      type: 'Transactions',
      date: tx.createdAt,
      createdAt: tx.createdAt,
      sender: tx.sender ? {
        id: tx.sender._id,
        name: tx.sender.name,
        email: tx.sender.email
      } : null,
      receiver: tx.receiver ? {
        id: tx.receiver._id,
        name: tx.receiver.name,
        email: tx.receiver.email
      } : null,
      initiatedBy: tx.initiatedBy ? {
        id: tx.initiatedBy._id,
        name: tx.initiatedBy.name,
        email: tx.initiatedBy.email
      } : null,
      from: tx.sender ? tx.sender.name : 'Unknown',
      to: tx.receiver ? tx.receiver.name : 'Unknown',
      amount: tx.amount,
      mode: tx.mode,
      purpose: tx.purpose || '',
      status: tx.status
    }));

    // Transform collections
    const transformedCollections = collections.map(col => ({
      id: col._id,
      type: 'Collections',
      date: col.createdAt,
      createdAt: col.createdAt,
      collectedBy: col.collectedBy ? {
        id: col.collectedBy._id,
        name: col.collectedBy.name,
        email: col.collectedBy.email
      } : null,
      assignedReceiver: col.assignedReceiver ? {
        id: col.assignedReceiver._id,
        name: col.assignedReceiver.name,
        email: col.assignedReceiver.email
      } : null,
      from: col.collectedBy ? col.collectedBy.name : 'Unknown',
      to: col.assignedReceiver ? col.assignedReceiver.name : 'Unknown',
      customerName: col.customerName,
      amount: col.amount,
      mode: col.mode,
      voucherNumber: col.voucherNumber,
      status: col.status,
      notes: col.notes || ''
    }));

    // Combine all data
    const allData = [
      ...transformedExpenses,
      ...transformedTransactions,
      ...transformedCollections
    ].sort((a, b) => {
      const dateA = new Date(a.date || a.createdAt);
      const dateB = new Date(b.date || b.createdAt);
      return dateB - dateA; // Newest first
    });

    // Calculate financial summary
    let cashIn = 0;
    let cashOut = 0;

    allData.forEach(item => {
      const amount = item.amount || 0;
      const itemStatus = item.status || 'Pending';

      if (item.type === 'Collections' && (itemStatus === 'Verified' || itemStatus === 'Approved')) {
        cashIn += amount;
      } else if (item.type === 'Expenses' && (itemStatus === 'Approved' || itemStatus === 'Completed')) {
        cashOut += amount;
      }
    });

    const balance = cashIn - cashOut;

    // Calculate filter breakdown
    const filterBreakdown = {
      Expenses: {
        Approved: { count: 0, amount: 0 },
        Unapproved: { count: 0, amount: 0 }
      },
      Transactions: {
        Approved: { count: 0, amount: 0 },
        Unapproved: { count: 0, amount: 0 }
      },
      Collections: {
        Verified: { count: 0, amount: 0 },
        Accountant: { count: 0, amount: 0 }
      }
    };

    allData.forEach(item => {
      const amount = item.amount || 0;
      const itemStatus = item.status || 'Pending';

      if (item.type === 'Expenses') {
        if (itemStatus === 'Approved' || itemStatus === 'Completed') {
          filterBreakdown.Expenses.Approved.count += 1;
          filterBreakdown.Expenses.Approved.amount += amount;
        } else {
          filterBreakdown.Expenses.Unapproved.count += 1;
          filterBreakdown.Expenses.Unapproved.amount += amount;
        }
      } else if (item.type === 'Transactions') {
        if (itemStatus === 'Approved' || itemStatus === 'Completed') {
          filterBreakdown.Transactions.Approved.count += 1;
          filterBreakdown.Transactions.Approved.amount += amount;
        } else {
          filterBreakdown.Transactions.Unapproved.count += 1;
          filterBreakdown.Transactions.Unapproved.amount += amount;
        }
      } else if (item.type === 'Collections') {
        if (itemStatus === 'Verified' || itemStatus === 'Approved') {
          filterBreakdown.Collections.Verified.count += 1;
          filterBreakdown.Collections.Verified.amount += amount;
        } else if (itemStatus === 'Accountant' || itemStatus === 'Pending') {
          filterBreakdown.Collections.Accountant.count += 1;
          filterBreakdown.Collections.Accountant.amount += amount;
        }
      }
    });

    res.status(200).json({
      success: true,
      data: allData,
      summary: {
        cashIn,
        cashOut,
        balance
      },
      filterBreakdown
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get dashboard live totals (cash in, cash out, balance)
// @route   GET /api/dashboard/totals
// @access  Private
exports.getDashboardTotals = async (req, res) => {
  try {
    const { calculateDashboardTotals } = require('./cashFlowController');
    const totals = await calculateDashboardTotals();

    res.status(200).json({
      success: true,
      dashboard: totals
    });
  } catch (error) {
    console.error('Error getting dashboard totals:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get dashboard totals'
    });
  }
};

// @desc    Get dashboard summary (financial summary, status counts, flagged items)
// @route   GET /api/dashboard/summary
// @access  Private (SuperAdmin, Admin with dashboard permission)
exports.getDashboardSummary = async (req, res) => {
  try {
    const userRole = req.user.role;
    const userId = req.user._id;
    const { userId: targetUserId } = req.query;

    console.log(`[Dashboard] getDashboardSummary - User Role: ${userRole}, User ID: ${userId}`);

    // Permission check
    // Allow all authenticated users by default
    // Only check for explicit permission if needed (for backward compatibility)
    // All roles are automatically allowed - no need to maintain a list
    // This ensures newly created roles work automatically

    // Build base filters (no payment mode filter, no date filter for totals)
    const baseExpenseFilterForCashOut = {}; // Expenses where user is APPROVER (Cash Out)
    const baseExpenseFilterForCashIn = {}; // Expenses where user is OWNER (for wallet transactions - handled separately)
    let baseExpenseFilter = {}; // Expenses where user is either APPROVER or OWNER (for status counts - includes PENDING and FLAGGED)
    const baseTransactionFilter = {};
    const baseCollectionFilter = {};
    const baseWalletTransactionFilter = { status: 'completed' };

    // User-specific filtering
    // Check if user is SuperAdmin or admin@examples.com/admin@example.com - can see all data
    const isSuperAdmin = userRole === 'SuperAdmin';
    const isProtectedUser = req.user.email === 'admin@examples.com' || req.user.email === 'admin@example.com';
    const canSeeAll = isSuperAdmin || isProtectedUser;
    
    let includeWalletTransactions = true;
    let userIdToFilter = null;
    
    if (canSeeAll) {
      // SuperAdmin and admin@examples.com/admin@example.com can see ALL data
      // No user filtering applied - empty filters will show all expenses, transactions, and collections
      console.log(`[Dashboard Summary] User ${req.user.email} (Role: ${userRole}) can see ALL data - no user filtering applied`);
      
      // For Status Counts: Show ALL expenses, transactions, and collections (no user filter)
      // baseExpenseFilter, baseTransactionFilter, and baseCollectionFilter remain empty {}
      // This means all records will be counted
      
      // For Cash In/Cash Out calculations, we still need to filter by user for their personal balance
      // But for Status Counts, we show everything
      userIdToFilter = userId; // Still use for wallet transactions
      
      // Get user's wallet for wallet transactions (for Cash In/Cash Out balance)
      const userIdObjectId = mongoose.Types.ObjectId.isValid(userId) 
        ? new mongoose.Types.ObjectId(userId) 
        : userId;
      const userWallet = await Wallet.findOne({ userId: userIdObjectId });
      if (userWallet) {
        baseWalletTransactionFilter.walletId = userWallet._id;
        console.log(`[Dashboard Summary] Found wallet for user: ${userWallet._id}`);
      } else {
        includeWalletTransactions = false;
        console.log(`[Dashboard Summary] No wallet found for user, skipping wallet transactions`);
      }
    } else {
      // Regular users: Only see their own data
      // - Always filter by the logged-in user's ID
      // - This ensures every user sees only their own Cash In/Cash Out Balance
      userIdToFilter = userId;
      console.log(`[Dashboard Summary] Filtering by logged-in user's ID: ${userId} (Role: ${userRole})`);
      
      if (userIdToFilter) {
        // Convert userIdToFilter to ObjectId if it's a string
        const userIdObjectId = mongoose.Types.ObjectId.isValid(userIdToFilter) 
          ? new mongoose.Types.ObjectId(userIdToFilter) 
          : userIdToFilter;
        
        // For Cash Out: Count expenses where user is the APPROVER (who paid for the expense)
        baseExpenseFilterForCashOut.approvedBy = userIdObjectId;
        
        // For Cash In: Count expenses where user is the OWNER (who received reimbursement)
        baseExpenseFilterForCashIn.userId = userIdObjectId;
        
        // For Status Counts: Include ALL expenses related to the user
        // - approvedBy: User approved the expense (Cash Out scenario)
        // - userId: User owns the expense (Cash In scenario - reimbursement)
        // - createdBy: User created the expense (should see in their status counts)
        // This ensures all expenses related to the user are counted (including PENDING and FLAGGED)
        baseExpenseFilter = {
          $or: [
            { approvedBy: userIdObjectId },
            { userId: userIdObjectId },
            { createdBy: userIdObjectId }
          ]
        };
        
        // For Status Counts: Include ALL transactions related to the user
        // - sender: User sent the transaction
        // - receiver: User received the transaction
        // - initiatedBy: User initiated the transaction (should see in their status counts)
        baseTransactionFilter.$or = [
          { sender: userIdObjectId },
          { receiver: userIdObjectId },
          { initiatedBy: userIdObjectId }
        ];
        
        // For Status Counts: Include ALL collections related to the user
        // - collectedBy: User collected the money
        // - assignedReceiver: User is assigned to receive the collection
        // - from: User is the source of the collection
        // - approvedBy: User approved the collection
        baseCollectionFilter.$or = [
          { collectedBy: userIdObjectId },
          { assignedReceiver: userIdObjectId },
          { from: userIdObjectId },
          { approvedBy: userIdObjectId }
        ];
        
        console.log(`[Dashboard Summary] Applied filters - Expense Cash Out (Approver):`, JSON.stringify(baseExpenseFilterForCashOut, null, 2));
        console.log(`[Dashboard Summary] Applied filters - Expense Status Counts:`, JSON.stringify(baseExpenseFilter, null, 2));
        console.log(`[Dashboard Summary] Applied filters - Transaction:`, JSON.stringify(baseTransactionFilter, null, 2));
        console.log(`[Dashboard Summary] Applied filters - Collection:`, JSON.stringify(baseCollectionFilter, null, 2));
        
        // Get user's wallet for wallet transactions
        const userWallet = await Wallet.findOne({ userId: userIdObjectId });
        if (userWallet) {
          baseWalletTransactionFilter.walletId = userWallet._id;
          console.log(`[Dashboard Summary] Found wallet for user: ${userWallet._id}`);
        } else {
          // No wallet, so skip wallet transactions for this user
          includeWalletTransactions = false;
          console.log(`[Dashboard Summary] No wallet found for user, skipping wallet transactions`);
        }
      }
    }

    // ============================================================================
    // FINANCIAL SUMMARY CALCULATION (Across ALL payment modes)
    // ============================================================================
    let cashIn = 0;
    let cashOut = 0;

    // 1. Collections Cash In (Verified/Approved)
    const collectionsCashIn = await Collection.aggregate([
      {
        $match: {
          ...baseCollectionFilter,
          status: { $in: ['Verified', 'Approved'] }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      }
    ]);
    if (collectionsCashIn.length > 0) {
      cashIn += collectionsCashIn[0].total || 0;
    }

    // 2a. Expenses Cash Out (Approved/Completed)
    // IMPORTANT: Count expenses where user is the APPROVER (who paid for the expense)
    const expensesCashOut = await Expense.aggregate([
      {
        $match: {
          ...baseExpenseFilterForCashOut,
          status: { $in: ['Approved', 'Completed'] }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      }
    ]);
    if (expensesCashOut.length > 0) {
      cashOut += expensesCashOut[0].total || 0;
    }

    // 2b. Expenses Cash In (Expense Reimbursements)
    // IMPORTANT: Count approved expenses where user is the OWNER (who received reimbursement)
    if (userIdToFilter) {
      const expensesCashIn = await Expense.aggregate([
        {
          $match: {
            ...baseExpenseFilterForCashIn,
            status: { $in: ['Approved', 'Completed'] }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$amount' },
            count: { $sum: 1 }
          }
        }
      ]);
      if (expensesCashIn.length > 0) {
        cashIn += expensesCashIn[0].total || 0;
      }
    }

    // 3. Wallet Transactions (only if wallet exists)
    if (includeWalletTransactions) {
      const walletTxnCashIn = await WalletTransaction.aggregate([
        {
          $match: {
            ...baseWalletTransactionFilter,
            type: 'add',
            operation: 'add'
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$amount' },
            count: { $sum: 1 }
          }
        }
      ]);
      if (walletTxnCashIn.length > 0) {
        cashIn += walletTxnCashIn[0].total || 0;
      }

      const walletTxnCashOut = await WalletTransaction.aggregate([
        {
          $match: {
            ...baseWalletTransactionFilter,
            type: 'withdraw',
            operation: 'subtract'
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$amount' },
            count: { $sum: 1 }
          }
        }
      ]);
      if (walletTxnCashOut.length > 0) {
        cashOut += walletTxnCashOut[0].total || 0;
      }
    }

    // 4. Transactions (if userIdToFilter provided, calculate based on sender/receiver)
    // IMPORTANT TRANSACTION LOGIC FOR ALL USERS:
    // - Only 'Approved' or 'Completed' transactions affect Cash In/Cash Out
    // - 'Pending', 'Flagged', 'Rejected', 'Cancelled' transactions are NOT counted
    // - When user is RECEIVER: Transaction amount = Cash In
    // - When user is SENDER: Transaction amount = Cash Out
    // - If transaction is rejected/cancelled after approval, wallet is reversed (handled in transactionController)
    // - This logic applies consistently to ALL users in the system
    if (userIdToFilter) {
      // Convert userIdToFilter to ObjectId if it's a string
      const userIdObjectId = mongoose.Types.ObjectId.isValid(userIdToFilter) 
        ? new mongoose.Types.ObjectId(userIdToFilter) 
        : userIdToFilter;
      
      // Calculate Cash In: Sum of all transactions where user is RECEIVER
      // Only count 'Approved' or 'Completed' transactions
      const transactionsAsReceiver = await Transaction.aggregate([
        {
          $match: {
            receiver: userIdObjectId,
            status: { $in: ['Approved', 'Completed'] } // Only approved/completed transactions count
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$amount' },
            count: { $sum: 1 }
          }
        }
      ]);
      if (transactionsAsReceiver.length > 0) {
        cashIn += transactionsAsReceiver[0].total || 0;
      }

      // Calculate Cash Out: Sum of all transactions where user is SENDER
      // Only count 'Approved' or 'Completed' transactions
      const transactionsAsSender = await Transaction.aggregate([
        {
          $match: {
            sender: userIdObjectId,
            status: { $in: ['Approved', 'Completed'] } // Only approved/completed transactions count
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$amount' },
            count: { $sum: 1 }
          }
        }
      ]);
      if (transactionsAsSender.length > 0) {
        cashOut += transactionsAsSender[0].total || 0;
      }
    }

    const balance = cashIn - cashOut;

    // ============================================================================
    // STATUS COUNTS CALCULATION (Across ALL payment modes)
    // ============================================================================
    const statusCounts = {
      expenses: {
        approved: { count: 0, amount: 0 },
        unapproved: { count: 0, amount: 0 },
        flagged: { count: 0, amount: 0 },
        total: { count: 0, amount: 0 }
      },
      transactions: {
        approved: { count: 0, amount: 0 },
        unapproved: { count: 0, amount: 0 },
        flagged: { count: 0, amount: 0 },
        total: { count: 0, amount: 0 }
      },
      collections: {
        accounted: { count: 0, amount: 0 },
        unaccounted: { count: 0, amount: 0 },
        flagged: { count: 0, amount: 0 },
        total: { count: 0, amount: 0 }
      }
    };

    // Expenses Status Counts
    console.log(`[Dashboard Summary] Querying expenses with filter:`, JSON.stringify(baseExpenseFilter, null, 2));
    const expenseStatusCounts = await Expense.aggregate([
      {
        $match: baseExpenseFilter
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      }
    ]);

    console.log(`[Dashboard Summary] Expense status counts found:`, expenseStatusCounts);
    console.log(`[Dashboard Summary] Total expenses found:`, expenseStatusCounts.reduce((sum, s) => sum + (s.count || 0), 0));

    expenseStatusCounts.forEach(stat => {
      const status = (stat._id || '').toLowerCase();
      const count = stat.count || 0;
      const amount = stat.totalAmount || 0;

      statusCounts.expenses.total.count += count;
      statusCounts.expenses.total.amount += amount;

      if (status === 'approved' || status === 'completed') {
        statusCounts.expenses.approved.count += count;
        statusCounts.expenses.approved.amount += amount;
      } else if (status === 'flagged') {
        statusCounts.expenses.flagged.count += count;
        statusCounts.expenses.flagged.amount += amount;
      } else {
        statusCounts.expenses.unapproved.count += count;
        statusCounts.expenses.unapproved.amount += amount;
      }
    });

    // Transactions Status Counts
    console.log(`[Dashboard Summary] Querying transactions with filter:`, JSON.stringify(baseTransactionFilter, null, 2));
    const transactionStatusCounts = await Transaction.aggregate([
      {
        $match: baseTransactionFilter
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      }
    ]);

    console.log(`[Dashboard Summary] Transaction status counts found:`, transactionStatusCounts);
    console.log(`[Dashboard Summary] Total transactions found:`, transactionStatusCounts.reduce((sum, s) => sum + (s.count || 0), 0));

    transactionStatusCounts.forEach(stat => {
      const status = (stat._id || '').toLowerCase();
      const count = stat.count || 0;
      const amount = stat.totalAmount || 0;

      statusCounts.transactions.total.count += count;
      statusCounts.transactions.total.amount += amount;

      if (status === 'approved' || status === 'completed') {
        statusCounts.transactions.approved.count += count;
        statusCounts.transactions.approved.amount += amount;
      } else if (status === 'flagged') {
        statusCounts.transactions.flagged.count += count;
        statusCounts.transactions.flagged.amount += amount;
      } else {
        statusCounts.transactions.unapproved.count += count;
        statusCounts.transactions.unapproved.amount += amount;
      }
    });

    // Collections Status Counts
    console.log(`[Dashboard Summary] Querying collections with filter:`, JSON.stringify(baseCollectionFilter, null, 2));
    const collectionStatusCounts = await Collection.aggregate([
      {
        $match: baseCollectionFilter
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      }
    ]);

    console.log(`[Dashboard Summary] Collection status counts found:`, collectionStatusCounts);
    console.log(`[Dashboard Summary] Total collections found:`, collectionStatusCounts.reduce((sum, s) => sum + (s.count || 0), 0));

    collectionStatusCounts.forEach(stat => {
      const status = (stat._id || '').toLowerCase();
      const count = stat.count || 0;
      const amount = stat.totalAmount || 0;

      statusCounts.collections.total.count += count;
      statusCounts.collections.total.amount += amount;

      if (status === 'verified' || status === 'approved') {
        statusCounts.collections.accounted.count += count;
        statusCounts.collections.accounted.amount += amount;
      } else if (status === 'flagged') {
        statusCounts.collections.flagged.count += count;
        statusCounts.collections.flagged.amount += amount;
      } else {
        statusCounts.collections.unaccounted.count += count;
        statusCounts.collections.unaccounted.amount += amount;
      }
    });

    // Ensure all status count fields have count and amount (even if 0)
    // This ensures frontend always receives the expected structure
    const finalStatusCounts = {
      expenses: {
        approved: {
          count: statusCounts.expenses.approved.count || 0,
          amount: statusCounts.expenses.approved.amount || 0
        },
        unapproved: {
          count: statusCounts.expenses.unapproved.count || 0,
          amount: statusCounts.expenses.unapproved.amount || 0
        },
        flagged: {
          count: statusCounts.expenses.flagged.count || 0,
          amount: statusCounts.expenses.flagged.amount || 0
        },
        total: {
          count: statusCounts.expenses.total.count || 0,
          amount: statusCounts.expenses.total.amount || 0
        }
      },
      transactions: {
        approved: {
          count: statusCounts.transactions.approved.count || 0,
          amount: statusCounts.transactions.approved.amount || 0
        },
        unapproved: {
          count: statusCounts.transactions.unapproved.count || 0,
          amount: statusCounts.transactions.unapproved.amount || 0
        },
        flagged: {
          count: statusCounts.transactions.flagged.count || 0,
          amount: statusCounts.transactions.flagged.amount || 0
        },
        total: {
          count: statusCounts.transactions.total.count || 0,
          amount: statusCounts.transactions.total.amount || 0
        }
      },
      collections: {
        accounted: {
          count: statusCounts.collections.accounted.count || 0,
          amount: statusCounts.collections.accounted.amount || 0
        },
        unaccounted: {
          count: statusCounts.collections.unaccounted.count || 0,
          amount: statusCounts.collections.unaccounted.amount || 0
        },
        flagged: {
          count: statusCounts.collections.flagged.count || 0,
          amount: statusCounts.collections.flagged.amount || 0
        },
        total: {
          count: statusCounts.collections.total.count || 0,
          amount: statusCounts.collections.total.amount || 0
        }
      }
    };

    console.log(`[Dashboard Summary] Final status counts:`, JSON.stringify(finalStatusCounts, null, 2));

    // Calculate Grand Total (sum of all categories)
    const grandTotal = {
      unaccounted: {
        count: finalStatusCounts.expenses.unapproved.count + 
               finalStatusCounts.transactions.unapproved.count + 
               finalStatusCounts.collections.unaccounted.count,
        amount: finalStatusCounts.expenses.unapproved.amount + 
                finalStatusCounts.transactions.unapproved.amount + 
                finalStatusCounts.collections.unaccounted.amount
      },
      flagged: {
        count: finalStatusCounts.expenses.flagged.count + 
               finalStatusCounts.transactions.flagged.count + 
               finalStatusCounts.collections.flagged.count,
        amount: finalStatusCounts.expenses.flagged.amount + 
                finalStatusCounts.transactions.flagged.amount + 
                finalStatusCounts.collections.flagged.amount
      },
      total: {
        count: finalStatusCounts.expenses.total.count + 
               finalStatusCounts.transactions.total.count + 
               finalStatusCounts.collections.total.count,
        amount: finalStatusCounts.expenses.total.amount + 
                finalStatusCounts.transactions.total.amount + 
                finalStatusCounts.collections.total.amount
      }
    };

    // ============================================================================
    // FLAGGED ITEMS
    // IMPORTANT: Flagged items should only show to the "from" person (the person who created/initiated the item)
    // - Expenses: createdBy (who created the expense)
    // - Transactions: initiatedBy or sender (who initiated/sent)
    // - Collections: from or collectedBy (who collected)
    // ============================================================================
    const flaggedItems = [];

    // Build filter for flagged items - filter by "from" person only
    // If userIdToFilter is provided, show flagged items where that user is the "from" person
    // If userIdToFilter is NOT provided and user is NOT SuperAdmin, show flagged items where logged-in user is the "from" person
    // If user is SuperAdmin and no userIdToFilter, show all flagged items (SuperAdmin can see all)
    let flaggedExpenseFilter = { status: 'Flagged' };
    let flaggedTransactionFilter = { status: 'Flagged' };
    let flaggedCollectionFilter = { status: 'Flagged' };

    if (userIdToFilter) {
      // Filter by target user being the "from" person
      const userIdObjectId = mongoose.Types.ObjectId.isValid(userIdToFilter) 
        ? new mongoose.Types.ObjectId(userIdToFilter) 
        : userIdToFilter;
      
      // Expenses: createdBy = userIdToFilter
      flaggedExpenseFilter.createdBy = userIdObjectId;
      
      // Transactions: initiatedBy = userIdToFilter OR sender = userIdToFilter
      flaggedTransactionFilter.$or = [
        { initiatedBy: userIdObjectId },
        { sender: userIdObjectId }
      ];
      
      // Collections: from = userIdToFilter OR collectedBy = userIdToFilter
      flaggedCollectionFilter.$or = [
        { from: userIdObjectId },
        { collectedBy: userIdObjectId }
      ];
      
      console.log(`[Dashboard Summary] Flagged items filter - showing flagged items where user ${userIdToFilter} is the "from" person`);
    } else if (userRole !== 'SuperAdmin') {
      // Non-SuperAdmin users: only show flagged items where they are the "from" person
      const userIdObjectId = mongoose.Types.ObjectId.isValid(userId) 
        ? new mongoose.Types.ObjectId(userId) 
        : userId;
      
      // Expenses: createdBy = logged-in user
      flaggedExpenseFilter.createdBy = userIdObjectId;
      
      // Transactions: initiatedBy = logged-in user OR sender = logged-in user
      flaggedTransactionFilter.$or = [
        { initiatedBy: userIdObjectId },
        { sender: userIdObjectId }
      ];
      
      // Collections: from = logged-in user OR collectedBy = logged-in user
      flaggedCollectionFilter.$or = [
        { from: userIdObjectId },
        { collectedBy: userIdObjectId }
      ];
      
      console.log(`[Dashboard Summary] Flagged items filter - showing flagged items where logged-in user ${userId} is the "from" person`);
    } else {
      // SuperAdmin with no userIdToFilter: show all flagged items
      console.log(`[Dashboard Summary] Flagged items filter - SuperAdmin showing all flagged items`);
    }

    // Get flagged expenses
    const flaggedExpenses = await Expense.find(flaggedExpenseFilter)
      .populate('userId', 'name email')
      .populate('createdBy', 'name email')
      .populate('flaggedBy', 'name email role')
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    flaggedExpenses.forEach(exp => {
      flaggedItems.push({
        id: exp._id,
        type: 'Expenses',
        date: exp.createdAt,
        createdAt: exp.createdAt,
        amount: exp.amount,
        status: exp.status,
        flagReason: exp.flagReason || '',
        flaggedBy: exp.flaggedBy ? {
          id: exp.flaggedBy._id,
          name: exp.flaggedBy.name,
          email: exp.flaggedBy.email,
          role: exp.flaggedBy.role
        } : null,
        flaggedAt: exp.flaggedAt || null,
        response: exp.response || null,
        responseDate: exp.responseDate || null,
        category: exp.category,
        mode: exp.mode,
        description: exp.description || '',
        userId: exp.userId ? {
          id: exp.userId._id,
          name: exp.userId.name,
          email: exp.userId.email
        } : null,
        createdBy: exp.createdBy ? {
          id: exp.createdBy._id,
          name: exp.createdBy.name,
          email: exp.createdBy.email
        } : null
      });
    });

    // Get flagged transactions
    const flaggedTransactions = await Transaction.find(flaggedTransactionFilter)
      .populate('sender', 'name email')
      .populate('receiver', 'name email')
      .populate('initiatedBy', 'name email')
      .populate('flaggedBy', 'name email role')
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    flaggedTransactions.forEach(tx => {
      flaggedItems.push({
        id: tx._id,
        type: 'Transactions',
        date: tx.createdAt,
        createdAt: tx.createdAt,
        amount: tx.amount,
        status: tx.status,
        flagReason: tx.flagReason || '',
        flaggedBy: tx.flaggedBy ? {
          id: tx.flaggedBy._id,
          name: tx.flaggedBy.name,
          email: tx.flaggedBy.email,
          role: tx.flaggedBy.role
        } : null,
        flaggedAt: tx.flaggedAt || null,
        response: tx.response || null,
        responseDate: tx.responseDate || null,
        mode: tx.mode,
        purpose: tx.purpose || '',
        sender: tx.sender ? {
          id: tx.sender._id,
          name: tx.sender.name,
          email: tx.sender.email
        } : null,
        receiver: tx.receiver ? {
          id: tx.receiver._id,
          name: tx.receiver.name,
          email: tx.receiver.email
        } : null,
        initiatedBy: tx.initiatedBy ? {
          id: tx.initiatedBy._id,
          name: tx.initiatedBy.name,
          email: tx.initiatedBy.email
        } : null
      });
    });

    // Get flagged collections
    const flaggedCollections = await Collection.find(flaggedCollectionFilter)
      .populate('collectedBy', 'name email')
      .populate('from', 'name email')
      .populate('assignedReceiver', 'name email')
      .populate('flaggedBy', 'name email role')
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    flaggedCollections.forEach(col => {
      flaggedItems.push({
        id: col._id,
        type: 'Collections',
        date: col.createdAt,
        createdAt: col.createdAt,
        amount: col.amount,
        status: col.status,
        flagReason: col.flagReason || '',
        flaggedBy: col.flaggedBy ? {
          id: col.flaggedBy._id,
          name: col.flaggedBy.name,
          email: col.flaggedBy.email,
          role: col.flaggedBy.role
        } : null,
        flaggedAt: col.flaggedAt || null,
        response: col.response || null,
        responseDate: col.responseDate || null,
        mode: col.mode,
        customerName: col.customerName,
        voucherNumber: col.voucherNumber,
        notes: col.notes || '',
        collectedBy: col.collectedBy ? {
          id: col.collectedBy._id,
          name: col.collectedBy.name,
          email: col.collectedBy.email
        } : null,
        from: col.from ? {
          id: col.from._id,
          name: col.from.name,
          email: col.from.email
        } : null,
        assignedReceiver: col.assignedReceiver ? {
          id: col.assignedReceiver._id,
          name: col.assignedReceiver.name,
          email: col.assignedReceiver.email
        } : null
      });
    });

    // Sort flagged items by date (newest first) and limit to 20
    flaggedItems.sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt));
    const limitedFlaggedItems = flaggedItems.slice(0, 20);

    // ============================================================================
    // RETURN RESPONSE
    // ============================================================================
    const responseData = {
      success: true,
      data: {
        financialSummary: {
          cashIn,
          cashOut,
          balance
        },
        statusCounts: {
          ...finalStatusCounts,
          grandTotal
        },
        flaggedItems: limitedFlaggedItems
      }
    };

    console.log(`[Dashboard Summary] Sending response with statusCounts:`, JSON.stringify(responseData.data.statusCounts, null, 2));
    
    res.status(200).json(responseData);
  } catch (error) {
    console.error('Error getting dashboard summary:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get dashboard summary'
    });
  }
};