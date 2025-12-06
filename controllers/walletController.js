const mongoose = require('mongoose');
const { getOrCreateWallet, updateWalletBalance } = require('../utils/walletHelper');
const { createAuditLog } = require('../utils/auditLogger');
const { notifyAmountUpdate } = require('../utils/amountUpdateHelper');
const User = require('../models/userModel');
const Wallet = require('../models/walletModel');
const WalletTransaction = require('../models/walletTransactionModel');
const Transaction = require('../models/transactionModel');
const Collection = require('../models/collectionModel');
const Expense = require('../models/expenseModel');

const STATUS_ALIASES = {
  approved: 'approved',
  'approved✅': 'approved',
  completed: 'approved',
  complete: 'approved',
  done: 'approved',
  verified: 'accounted',
  verify: 'accounted',
  'verified✅': 'accounted',
  approvedandverified: 'accounted',
  accounted: 'unaccounted',
  unaccounted: 'unaccounted',
  notaccounted: 'unaccounted',
  un_accounted: 'unaccounted',
  'un-accounted': 'unaccounted',
  pending: 'unapproved',
  inprogress: 'unapproved',
  processing: 'unapproved',
  flagged: 'flagged',
  rejected: 'rejected',
  cancelled: 'rejected'
};

const normalizeStatusKey = (status = '') => {
  const trimmed = status.toString().trim();
  if (!trimmed || trimmed === '-') {
    return '';
  }

  const lower = trimmed.toLowerCase();
  if (STATUS_ALIASES[lower]) {
    return STATUS_ALIASES[lower];
  }

  const sanitized = lower.replace(/[^a-z]/g, '');
  return STATUS_ALIASES[sanitized] || sanitized;
};

const toSafeNumber = (value) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const parsed = parseFloat(value.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

// Helper function to create wallet transaction entry
const createWalletTransaction = async (wallet, type, mode, amount, operation, performedBy, options = {}) => {
  try {
    const transaction = await WalletTransaction.create({
      userId: wallet.userId,
      walletId: wallet._id,
      type,
      mode,
      amount,
      operation,
      fromMode: options.fromMode || null,
      toMode: options.toMode || null,
      fromUserId: options.fromUserId || null,
      toUserId: options.toUserId || null,
      relatedId: options.relatedId || null,
      relatedModel: options.relatedModel || null,
      balanceAfter: {
        cashBalance: wallet.cashBalance,
        upiBalance: wallet.upiBalance,
        bankBalance: wallet.bankBalance,
        totalBalance: wallet.totalBalance
      },
      notes: options.notes || '',
      performedBy,
      status: 'completed'
    });

    return transaction;
  } catch (error) {
    console.error('Error creating wallet transaction:', error);
    // Don't throw error, just log it - transaction creation shouldn't break the main operation
    return null;
  }
};

// @desc    Check if user has wallet (without creating)
// @route   GET /api/wallet/check/:userId?
// @access  Private
exports.checkWalletExists = async (req, res) => {
  try {
    // If userId is provided in params, use it; otherwise check current user
    const userId = req.params.userId && req.params.userId !== 'null' && req.params.userId !== 'undefined'
      ? req.params.userId
      : req.user._id;
    
    // Check if wallet exists without creating
    const wallet = await Wallet.findOne({ userId });
    
    res.status(200).json({
      success: true,
      hasWallet: wallet !== null
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get wallet balance
// @route   GET /api/wallet
// @access  Private
exports.getWallet = async (req, res) => {
  try {
    const wallet = await getOrCreateWallet(req.user._id);

    // Convert to plain object to ensure virtual fields (totalBalance) are included
    const walletObj = wallet.toObject ? wallet.toObject() : wallet;
    
    // Ensure totalBalance is calculated and included
    if (!walletObj.totalBalance) {
      walletObj.totalBalance = (walletObj.cashBalance || 0) + 
                                (walletObj.upiBalance || 0) + 
                                (walletObj.bankBalance || 0);
    }

    res.status(200).json({
      success: true,
      wallet: walletObj
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Add amount to wallet
// @route   POST /api/wallet/add
// @access  Private (All users - SuperAdmin can add to any wallet, others to their own)
exports.addAmount = async (req, res) => {
  try {
    const { mode, amount, notes } = req.body;

    if (!mode || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Please provide mode and amount'
      });
    }

    if (!['Cash', 'UPI', 'Bank'].includes(mode)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid mode. Must be Cash, UPI, or Bank'
      });
    }

    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be greater than 0'
      });
    }

    // Get target user wallet - role-based access control
    let targetUserId;
    if (req.user.role === 'SuperAdmin') {
      // SuperAdmin can specify userId, default to their own
      targetUserId = req.body.userId || req.user._id;
    } else {
      // Other users can only operate on their own wallet
      targetUserId = req.user._id;
      // Ignore userId if provided by non-SuperAdmin
      if (req.body.userId && req.body.userId.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'You can only add amounts to your own wallet'
        });
      }
    }
    const wallet = await updateWalletBalance(targetUserId, mode, amount, 'add', 'add');
    
    // Get user info for notification
    const targetUser = await User.findById(targetUserId);

    // Create wallet transaction entry
    const defaultNotes = req.user.role === 'SuperAdmin' 
      ? 'Amount added by SuperAdmin'
      : `Amount added by ${req.user.name || 'User'}`;
    
    const walletTransaction = await createWalletTransaction(
      wallet,
      'add',
      mode,
      amount,
      'add',
      req.user._id,
      { notes: notes || defaultNotes }
    );

    await createAuditLog(
      req.user._id,
      `Added ${amount} to ${mode} wallet`,
      'Update',
      'Wallet',
      wallet._id,
      { [mode.toLowerCase()]: wallet[mode.toLowerCase()] - amount },
      { [mode.toLowerCase()]: wallet[mode.toLowerCase()] },
      req.ip,
      notes || defaultNotes
    );

    // Emit real-time update to super admin and target user
    await notifyAmountUpdate('wallet_add', {
      userId: targetUserId,
      userName: targetUser?.name || 'Unknown',
      mode,
      amount,
      operation: 'add',
      wallet: {
        cashBalance: wallet.cashBalance,
        upiBalance: wallet.upiBalance,
        bankBalance: wallet.bankBalance,
        totalBalance: wallet.totalBalance
      },
      notes: notes || defaultNotes,
      performedBy: req.user._id,
      transactionId: walletTransaction?._id
    });

    // Emit self wallet update to the target user
    const { emitSelfWalletUpdate } = require('../utils/socketService');
    emitSelfWalletUpdate(targetUserId.toString(), {
      type: 'wallet_add',
      wallet: {
        cashBalance: wallet.cashBalance,
        upiBalance: wallet.upiBalance,
        bankBalance: wallet.bankBalance,
        totalBalance: wallet.totalBalance
      },
      transaction: walletTransaction ? {
        id: walletTransaction._id,
        type: walletTransaction.type,
        mode: walletTransaction.mode,
        amount: walletTransaction.amount,
        operation: walletTransaction.operation,
        createdAt: walletTransaction.createdAt
      } : null
    });

    // Emit All Wallet Reports update (recalculate totals and emit to SuperAdmins)
    try {
      const { emitAllWalletReportsUpdate } = require('../utils/socketService');
      const { calculateAllUsersTotals } = require('./allWalletReportsController');
      const totals = await calculateAllUsersTotals();
      await emitAllWalletReportsUpdate({
        totals: {
          totalCashIn: totals.totalCashIn,
          totalCashOut: totals.totalCashOut,
          totalBalance: totals.totalBalance
        },
        userId: targetUserId.toString()
      });
    } catch (error) {
      console.error('❌ [ALL WALLET REPORTS] Error emitting update after addAmount:', error);
      // Don't fail the request if All Wallet Reports update fails
    }

    // Convert wallet to plain object to ensure virtual fields are included
    const walletObj = wallet.toObject ? wallet.toObject() : wallet;
    if (!walletObj.totalBalance) {
      walletObj.totalBalance = (walletObj.cashBalance || 0) + 
                                (walletObj.upiBalance || 0) + 
                                (walletObj.bankBalance || 0);
    }

    res.status(200).json({
      success: true,
      message: 'Amount added successfully',
      wallet: walletObj
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Withdraw amount from wallet
// @route   POST /api/wallet/withdraw
// @access  Private (All users - SuperAdmin can withdraw from any wallet, others from their own)
exports.withdrawAmount = async (req, res) => {
  try {
    const { mode, amount, notes } = req.body;

    if (!mode || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Please provide mode and amount'
      });
    }

    if (!['Cash', 'UPI', 'Bank'].includes(mode)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid mode. Must be Cash, UPI, or Bank'
      });
    }

    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be greater than 0'
      });
    }

    // Get target user wallet - role-based access control
    let targetUserId;
    if (req.user.role === 'SuperAdmin') {
      // SuperAdmin can specify userId, default to their own
      targetUserId = req.body.userId || req.user._id;
    } else {
      // Other users can only operate on their own wallet
      targetUserId = req.user._id;
      // Ignore userId if provided by non-SuperAdmin
      if (req.body.userId && req.body.userId.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'You can only withdraw amounts from your own wallet'
        });
      }
    }
    const wallet = await updateWalletBalance(targetUserId, mode, amount, 'subtract', 'withdraw');
    
    // Get user info for notification
    const targetUser = await User.findById(targetUserId);

    // Create wallet transaction entry
    const defaultNotes = req.user.role === 'SuperAdmin' 
      ? 'Amount withdrawn by SuperAdmin'
      : `Amount withdrawn by ${req.user.name || 'User'}`;
    
    const walletTransaction = await createWalletTransaction(
      wallet,
      'withdraw',
      mode,
      amount,
      'subtract',
      req.user._id,
      { notes: notes || defaultNotes }
    );

    await createAuditLog(
      req.user._id,
      `Withdrew ${amount} from ${mode} wallet`,
      'Update',
      'Wallet',
      wallet._id,
      { [mode.toLowerCase()]: wallet[mode.toLowerCase()] + amount },
      { [mode.toLowerCase()]: wallet[mode.toLowerCase()] },
      req.ip,
      notes || defaultNotes
    );

    // Emit real-time update to super admin
    await notifyAmountUpdate('wallet_withdraw', {
      userId: targetUserId,
      userName: targetUser?.name || 'Unknown',
      mode,
      amount,
      operation: 'subtract',
      wallet: {
        cashBalance: wallet.cashBalance,
        upiBalance: wallet.upiBalance,
        bankBalance: wallet.bankBalance,
        totalBalance: wallet.totalBalance
      },
      notes: notes || defaultNotes,
      performedBy: req.user._id,
      transactionId: walletTransaction?._id
    });

    // Emit self wallet update to the target user
    const { emitSelfWalletUpdate } = require('../utils/socketService');
    emitSelfWalletUpdate(targetUserId.toString(), {
      type: 'wallet_withdraw',
      wallet: {
        cashBalance: wallet.cashBalance,
        upiBalance: wallet.upiBalance,
        bankBalance: wallet.bankBalance,
        totalBalance: wallet.totalBalance
      },
      transaction: walletTransaction ? {
        id: walletTransaction._id,
        type: walletTransaction.type,
        mode: walletTransaction.mode,
        amount: walletTransaction.amount,
        operation: walletTransaction.operation,
        createdAt: walletTransaction.createdAt
      } : null
    });

    // Emit All Wallet Reports update (recalculate totals and emit to SuperAdmins)
    try {
      const { emitAllWalletReportsUpdate } = require('../utils/socketService');
      const { calculateAllUsersTotals } = require('./allWalletReportsController');
      const totals = await calculateAllUsersTotals();
      await emitAllWalletReportsUpdate({
        totals: {
          totalCashIn: totals.totalCashIn,
          totalCashOut: totals.totalCashOut,
          totalBalance: totals.totalBalance
        },
        userId: targetUserId.toString()
      });
    } catch (error) {
      console.error('❌ [ALL WALLET REPORTS] Error emitting update after withdrawAmount:', error);
      // Don't fail the request if All Wallet Reports update fails
    }

    // Convert wallet to plain object to ensure virtual fields are included
    const walletObj = wallet.toObject ? wallet.toObject() : wallet;
    if (!walletObj.totalBalance) {
      walletObj.totalBalance = (walletObj.cashBalance || 0) + 
                                (walletObj.upiBalance || 0) + 
                                (walletObj.bankBalance || 0);
    }

    res.status(200).json({
      success: true,
      message: 'Amount withdrawn successfully',
      wallet: walletObj
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get all user wallets (SuperAdmin only)
// @route   GET /api/wallet/all
// @access  Private (SuperAdmin only)
exports.getAllWallets = async (req, res) => {
  try {
    console.log(`\n[getAllWallets] Request from: ${req.user.email} (${req.user.role})`);
    const wallets = await Wallet.find().populate('userId', 'name email phone phoneNumber role isVerified');
    console.log(`[getAllWallets] Found ${wallets.length} wallets in database`);
    
    // Calculate flagged and unapproved counts for each wallet
    const walletsWithUser = await Promise.all(wallets.map(async (wallet) => {
      const user = wallet.userId;
      const userId = user?._id;
      const isActive = user && (user.isVerified === true || wallet.totalBalance > 0);
      
      let flaggedCount = 0;
      let unapprovedCount = 0;
      
      if (userId) {
        // Count flagged items (Expenses, Transactions, Collections with status = 'Flagged')
        const flaggedExpenses = await Expense.countDocuments({ 
          userId: userId, 
          status: { $regex: /^flagged$/i } 
        });
        const flaggedTransactions = await Transaction.countDocuments({ 
          $or: [{ sender: userId }, { receiver: userId }, { initiatedBy: userId }],
          status: { $regex: /^flagged$/i }
        });
        const flaggedCollections = await Collection.countDocuments({ 
          $or: [{ collectedBy: userId }, { assignedReceiver: userId }],
          status: { $regex: /^flagged$/i }
        });
        flaggedCount = flaggedExpenses + flaggedTransactions + flaggedCollections;
        
        // Count unapproved/pending items
        // For Expenses: Pending, Unapproved
        const unapprovedExpenses = await Expense.countDocuments({ 
          userId: userId, 
          status: { $in: ['Pending', 'Unapproved', 'pending', 'unapproved'] } 
        });
        // For Transactions: Pending, Unapproved
        const unapprovedTransactions = await Transaction.countDocuments({ 
          $or: [{ sender: userId }, { receiver: userId }, { initiatedBy: userId }],
          status: { $in: ['Pending', 'Unapproved', 'pending', 'unapproved'] }
        });
        // For Collections: Pending, Unaccounted (which are unapproved)
        const unapprovedCollections = await Collection.countDocuments({ 
          $or: [{ collectedBy: userId }, { assignedReceiver: userId }],
          status: { $in: ['Pending', 'Unaccounted', 'pending', 'unaccounted'] }
        });
        unapprovedCount = unapprovedExpenses + unapprovedTransactions + unapprovedCollections;
      }
      
      return {
        _id: wallet._id,
        userId: wallet.userId,
        cashBalance: wallet.cashBalance,
        upiBalance: wallet.upiBalance,
        bankBalance: wallet.bankBalance,
        totalBalance: wallet.totalBalance,
        isActive: isActive,
        status: isActive ? 'active' : 'inactive',
        flaggedCount: flaggedCount,
        unapprovedCount: unapprovedCount,
        updatedAt: wallet.updatedAt,
        createdAt: wallet.createdAt
      };
    }));

    console.log(`[getAllWallets] Returning ${walletsWithUser.length} wallets to ${req.user.email}`);
    res.status(200).json({
      success: true,
      count: walletsWithUser.length,
      wallets: walletsWithUser
    });
  } catch (error) {
    console.error(`[getAllWallets] Error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get wallet activity report with optional filters (DEPRECATED)
// @route   GET /api/wallet/report
// @access  Private (SuperAdmin, Admin)
exports.getWalletReport = async (req, res) => {
  try {
    console.log('\n📊 ===== WALLET REPORT REQUEST =====');
    console.log('   Timestamp:', new Date().toISOString());
    console.log('   User:', req.user.email, `(${req.user.role})`);
    console.log('   Query Params:', {
      userId: req.query.userId || 'none',
      userRole: req.query.userRole || 'none',
      status: req.query.status || 'none',
      mode: req.query.mode || 'none',
      type: req.query.type || 'none',
      accountId: req.query.accountId || 'none',
      startDate: req.query.startDate || 'none',
      endDate: req.query.endDate || 'none'
    });
    // Log if multiple users are being requested
    if (req.query.userId && (Array.isArray(req.query.userId) || (typeof req.query.userId === 'string' && req.query.userId.includes(',')))) {
      console.log('   [MULTIPLE USERS DETECTED]');
    }
    console.log('=====================================\n');

    const {
      userId,
      userRole,
      startDate,
      endDate,
      mode,
      status,
      type,
      accountId
    } = req.query;

    // ============================================================================
    // MULTIPLE USER SELECTION SUPPORT
    // ============================================================================
    // Support multiple userIds in the following formats:
    // - Single userId: ?userId=123
    // - Comma-separated: ?userId=123,456,789
    // - Array: ?userId[]=123&userId[]=456
    // ============================================================================
    let targetUserIds = null; // Array of user IDs (null = all users, single element = single user)
    let targetUserId = null; // Single user ID (for backward compatibility)
    
    if (userId) {
      // Parse userId - handle array, comma-separated string, or single value
      let userIds = [];
      
      if (Array.isArray(userId)) {
        // Array format: userId[]=123&userId[]=456
        userIds = userId;
      } else if (typeof userId === 'string' && userId.includes(',')) {
        // Comma-separated format: userId=123,456,789
        userIds = userId.split(',').map(id => id.trim()).filter(id => id);
      } else {
        // Single userId: userId=123
        userIds = [userId];
      }
      
      // Validate all userIds
      const invalidIds = userIds.filter(id => !mongoose.Types.ObjectId.isValid(id));
      if (invalidIds.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Invalid userId(s) provided: ${invalidIds.join(', ')}`
        });
      }
      
      // Authorization check: Non-SuperAdmin users can only view their own data
      if (req.user.role !== 'SuperAdmin') {
        const loggedInUserId = req.user._id.toString();
        const unauthorizedIds = userIds.filter(id => id !== loggedInUserId);
        if (unauthorizedIds.length > 0) {
          return res.status(403).json({
            success: false,
            message: 'You can only view your own wallet report'
          });
        }
      }
      
      // Convert to ObjectIds
      const objectIds = userIds.map(id => new mongoose.Types.ObjectId(id));
      
      if (objectIds.length === 1) {
        // Single user - use backward compatible targetUserId
        targetUserId = objectIds[0];
        targetUserIds = null; // Not using multiple user mode
      } else {
        // Multiple users - use targetUserIds array
        targetUserIds = objectIds;
        targetUserId = null; // Clear single user ID
      }
      
      console.log(`✅ Filtering by ${objectIds.length} user(s): ${objectIds.map(id => id.toString()).join(', ')}`);
    } else {
      // No userId provided - automatically filter by logged-in user for non-SuperAdmin
      // SuperAdmin sees all data if no userId is specified
      if (req.user.role !== 'SuperAdmin') {
        targetUserId = req.user._id;
        targetUserIds = null;
      }
      // SuperAdmin with no userId sees all data (targetUserId and targetUserIds remain null)
    }

    // ============================================================================
    // ROLE-BASED FILTERING LOGIC
    // ============================================================================
    // When userRole is provided, find all users with that role and filter data
    // to show only transactions/expenses/collections for those users.
    // Note: userId filter takes precedence over userRole filter (more specific)
    // ============================================================================
    let roleFilteredUserIds = null;
    if (userRole && userRole.trim() !== '' && !targetUserId && !targetUserIds) {
      // Only apply role filter if userId is not provided (userId is more specific)
      const User = require('../models/userModel');
      const usersWithRole = await User.find({ role: userRole.trim() })
        .select('_id name email role');
      
      roleFilteredUserIds = usersWithRole.map(u => u._id);
      
      if (roleFilteredUserIds.length === 0) {
        // No users found with this role - return empty result
        console.log(`⚠️  No users found with role: "${userRole.trim()}"`);
        return res.status(200).json({
          success: true,
          count: 0,
          data: [],
          wallet: null,
          walletSummary: null,
          summary: { cashIn: 0, cashOut: 0, balance: 0 },
          breakdown: {
            Expenses: { 
              Approved: { count: 0, amount: 0 }, 
              Unapproved: { count: 0, amount: 0 },
              Flagged: { count: 0, amount: 0 },
              Rejected: { count: 0, amount: 0 }
            },
            Transactions: { 
              Approved: { count: 0, amount: 0 }, 
              Unapproved: { count: 0, amount: 0 },
              Flagged: { count: 0, amount: 0 },
              Rejected: { count: 0, amount: 0 }
            },
            Collections: { 
              Accounted: { count: 0, amount: 0 }, 
              Unaccounted: { count: 0, amount: 0 },
              Flagged: { count: 0, amount: 0 },
              Rejected: { count: 0, amount: 0 }
            }
          },
          filterMode: 'role',
          roleInfo: {
            role: userRole.trim(),
            userCount: 0
          }
        });
      }
      
      console.log(`✅ Filtering by User Role: "${userRole.trim()}" (${roleFilteredUserIds.length} users found)`);
      console.log(`   User IDs: ${roleFilteredUserIds.map(id => id.toString()).join(', ')}`);
    }

    // ============================================================================
    // DATA INCLUSION LOGIC - Based on account filtering
    // ============================================================================
    // When filtering by a specific accountId (e.g., "Sales UPI" or "Purchase UPI"):
    // - Collections: INCLUDED (filtered by paymentModeId)
    // - Wallet Transactions: INCLUDED (filtered by accountId in notes)
    // - Expenses: EXCLUDED (cannot distinguish between specific accounts)
    // - Transactions: EXCLUDED (cannot distinguish between specific accounts)
    //
    // This ensures each account shows ONLY its own data, maintaining complete
    // separation between accounts.
    // ============================================================================
    const isFilteringBySpecificAccount = accountId != null;
    
    const includeExpenses = (!type || type === 'Expenses') && !isFilteringBySpecificAccount;
    const includeTransactions = (!type || type === 'Transactions') && !isFilteringBySpecificAccount;
    const includeCollections = !type || type === 'Collections';

    const dateRange = {};
    if (startDate) {
      const parsedStart = new Date(startDate);
      if (!Number.isNaN(parsedStart.getTime())) {
        dateRange.$gte = parsedStart;
      }
    }
    if (endDate) {
      const parsedEnd = new Date(endDate);
      if (!Number.isNaN(parsedEnd.getTime())) {
        parsedEnd.setHours(23, 59, 59, 999);
        dateRange.$lte = parsedEnd;
      }
    }

    const expenseFilter = {};
    const transactionFilter = {};
    const collectionFilter = {};

    if (Object.keys(dateRange).length) {
      expenseFilter.createdAt = { ...dateRange };
      transactionFilter.createdAt = { ...dateRange };
      collectionFilter.createdAt = { ...dateRange };
    }

    if (mode) {
      expenseFilter.mode = mode;
      transactionFilter.mode = mode;
      collectionFilter.mode = mode;
    }

    // ============================================================================
    // ACCOUNT-SPECIFIC FILTERING LOGIC
    // ============================================================================
    // When accountId is provided (e.g., "Sales UPI" or "Purchase UPI"), we filter
    // data to show ONLY that specific account's data. Each account is completely
    // separate with its own collections, wallet transactions, and summary.
    //
    // SEPARATION STRATEGY:
    // 1. Collections: Filter by paymentModeId (exact match) - each collection has
    //    a specific paymentModeId that links it to one account
    // 2. Wallet Transactions: Filter by accountId in notes field - each Add/Withdraw
    //    operation stores the accountId in the notes
    // 3. Expenses/Transactions: EXCLUDED when filtering by accountId because they
    //    only have generic mode ('UPI', 'Cash', 'Bank') and cannot distinguish
    //    between specific accounts like "Sales UPI" vs "Purchase UPI"
    // ============================================================================
    let selectedPaymentMode = null;
    let accountModeType = null;
    if (accountId) {
      if (!mongoose.Types.ObjectId.isValid(accountId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid accountId provided'
        });
      }

      try {
        const PaymentMode = require('../models/paymentModeModel');
        selectedPaymentMode = await PaymentMode.findById(accountId);
        
        if (selectedPaymentMode) {
          // ========================================================================
          // COLLECTIONS FILTERING - Exact paymentModeId match
          // ========================================================================
          // Each collection has a paymentModeId field that links it to a specific
          // payment mode account. By filtering with exact match, we ensure:
          // - Sales UPI collections only show when Sales UPI is selected
          // - Purchase UPI collections only show when Purchase UPI is selected
          // - New payment modes with no data show zero (no collections match)
          // - No mixing of data between accounts
          // IMPORTANT: Only include collections that have this exact paymentModeId
          // Collections without paymentModeId or with different paymentModeId are excluded
          // MongoDB ObjectId match automatically excludes null/undefined values
          // We use exact ObjectId match to ensure complete separation between accounts
          collectionFilter.paymentModeId = new mongoose.Types.ObjectId(accountId);
          
          // Note: The validation in transformedCollections (below) provides an additional
          // layer of security to ensure no collections slip through that don't match
          
          // ========================================================================
          // EXPENSES/TRANSACTIONS - Excluded when filtering by accountId
          // ========================================================================
          // Expenses and transactions only have a generic 'mode' field ('UPI', 'Cash', 'Bank')
          // They do NOT have a paymentModeId field, so we cannot distinguish between
          // "Sales UPI" expenses and "Purchase UPI" expenses. Therefore, we exclude
          // them entirely when filtering by a specific accountId to maintain data integrity.
          // This is handled by setting includeExpenses and includeTransactions to false
          // when accountId is provided (see below).
          
          // ========================================================================
          // WALLET TRANSACTIONS FILTERING - By accountId in notes
          // ========================================================================
          // Determine mode type from payment mode for wallet transactions filtering
          // This helps filter wallet transactions by mode, and then we further filter
          // by accountId in the notes field (see walletTransactionFilter below)
          const modeName = (selectedPaymentMode.modeName || '').toLowerCase();
          const description = (selectedPaymentMode.description || '').toLowerCase();
          
          if (modeName.includes('cash') || description.includes('cash')) {
            accountModeType = 'Cash';
          } else if (modeName.includes('upi') || description.includes('upi')) {
            accountModeType = 'UPI';
          } else if (modeName.includes('bank') || description.includes('bank')) {
            accountModeType = 'Bank';
          }
          
          // ========================================================================
          // CRITICAL: DO NOT APPLY MODE FILTER TO COLLECTIONS WHEN FILTERING BY ACCOUNTID
          // ========================================================================
          // When filtering by a specific accountId, we should ONLY filter by paymentModeId,
          // NOT by mode type (UPI, Cash, Bank).
          // 
          // Why? Multiple payment modes can share the same mode type:
          // - "Sales UPI" and "Purchase UPI" both have mode type "UPI"
          // - "Marketing UPI" and "Sales UPI" both have mode type "UPI"
          // 
          // If we filter by mode type in addition to paymentModeId, it's redundant
          // and could potentially cause issues. The paymentModeId filter is sufficient
          // and ensures complete separation between accounts.
          // 
          // Collections are filtered ONLY by paymentModeId (exact match) - no mode filter needed
          // ========================================================================
        } else {
          return res.status(404).json({
            success: false,
            message: 'Payment mode not found'
          });
        }
      } catch (error) {
        console.error('Error fetching payment mode:', error);
        return res.status(500).json({
          success: false,
          message: 'Error fetching payment mode information'
        });
      }
    }

    if (targetUserIds && targetUserIds.length > 1) {
      // ============================================================================
      // MULTIPLE USERS SELECTED - Sum of Self Wallets
      // ============================================================================
      // When multiple users are selected, we need to:
      // 1. Filter data for all selected users
      // 2. Calculate each user's self wallet separately
      // 3. Sum up their Cash In, Cash Out, and Balance values
      // 4. Combine their transaction data for display
      // ============================================================================
      expenseFilter.userId = { $in: targetUserIds };
      
      transactionFilter.$or = [
        { sender: { $in: targetUserIds } },
        { receiver: { $in: targetUserIds } }
      ];
      
      collectionFilter.$or = [
        { collectedBy: { $in: targetUserIds } },
        { assignedReceiver: { $in: targetUserIds } }
      ];
      
      console.log(`✅ Filtering by ${targetUserIds.length} Users: ${targetUserIds.map(id => id.toString()).join(', ')}`);
      console.log('   [NOTE: Will sum each user\'s self wallet values]');
      console.log('   Collections: Including where user is collectedBy OR assignedReceiver');
    } else if (targetUserId) {
      // For Self Wallet OR All Wallet Report with single user filter: Only show the selected user's own data
      // This ensures All Wallet Report (when user is selected) shows the SAME data as Self Wallet view
      // Expenses: Only expenses owned by the user (userId), not expenses created by them for others
      expenseFilter.userId = targetUserId;
      
      // Transactions: Only transactions where user is directly involved (sender or receiver)
      // Exclude transactions initiated by the user but not involving them
      transactionFilter.$or = [
        { sender: targetUserId },
        { receiver: targetUserId }
      ];
      
      // Collections: Include collections where user is either:
      // 1. The collector (collectedBy) - money they collected
      // 2. The assigned receiver (assignedReceiver) - money assigned to them
      // This ensures we show all collections relevant to the user's wallet
      collectionFilter.$or = [
        { collectedBy: targetUserId },
        { assignedReceiver: targetUserId }
      ];
      
      console.log('✅ Filtering by User ID:', targetUserId.toString());
      console.log('   [NOTE: This matches Self Wallet view for this user]');
      console.log('   Collections: Including where user is collectedBy OR assignedReceiver');
    } else if (roleFilteredUserIds) {
      // Filter by user role: Include data for all users with the specified role
      // Expenses: Only expenses owned by users with this role
      expenseFilter.userId = { $in: roleFilteredUserIds };
      
      // Transactions: Include transactions where sender OR receiver has this role
      transactionFilter.$or = [
        { sender: { $in: roleFilteredUserIds } },
        { receiver: { $in: roleFilteredUserIds } }
      ];
      
      // Collections: Include collections where collectedBy OR assignedReceiver has this role
      collectionFilter.$or = [
        { collectedBy: { $in: roleFilteredUserIds } },
        { assignedReceiver: { $in: roleFilteredUserIds } }
      ];
      
      console.log('✅ Filtering by User Role:', userRole.trim());
      console.log(`   Found ${roleFilteredUserIds.length} users with this role`);
      console.log('   Collections: Including where collectedBy OR assignedReceiver has this role');
    } else {
      console.log('📋 Showing ALL users data (SuperAdmin view)');
    }

    if (status) {
      const normalizedStatus = normalizeStatusKey(status);

      const applyStatusFilter = (filter, values) => {
        if (Array.isArray(values)) {
          filter.status = { $in: values };
        } else if (values && values.$in) {
          filter.status = { $in: values.$in };
        } else if (values && values.$nin) {
          filter.status = { $nin: values.$nin };
        } else if (values) {
          filter.status = values;
        }
      };

      switch (normalizedStatus) {
        case 'approved':
          if (includeExpenses) applyStatusFilter(expenseFilter, { $in: ['Approved', 'Completed'] });
          if (includeTransactions) applyStatusFilter(transactionFilter, { $in: ['Approved', 'Completed'] });
          if (includeCollections) applyStatusFilter(collectionFilter, { $in: ['Approved', 'Verified'] });
          break;
        case 'unapproved':
          if (includeExpenses) applyStatusFilter(expenseFilter, { $nin: ['Approved', 'Completed'] });
          if (includeTransactions) applyStatusFilter(transactionFilter, { $nin: ['Approved', 'Completed'] });
          if (includeCollections) applyStatusFilter(collectionFilter, { $nin: ['Approved', 'Verified'] });
          break;
        case 'accounted':
          if (includeCollections) applyStatusFilter(collectionFilter, { $in: ['Approved', 'Verified'] });
          break;
        case 'unaccounted':
          if (includeCollections) applyStatusFilter(collectionFilter, { $in: ['Pending', 'Accountant'] });
          break;
        case 'flagged':
          if (includeExpenses) applyStatusFilter(expenseFilter, 'Flagged');
          if (includeTransactions) applyStatusFilter(transactionFilter, 'Flagged');
          if (includeCollections) applyStatusFilter(collectionFilter, 'Flagged');
          break;
        case 'rejected':
          if (includeExpenses) applyStatusFilter(expenseFilter, 'Rejected');
          if (includeTransactions) applyStatusFilter(transactionFilter, 'Rejected');
          if (includeCollections) applyStatusFilter(collectionFilter, 'Rejected');
          break;
        default:
          if (includeExpenses) applyStatusFilter(expenseFilter, status);
          if (includeTransactions) applyStatusFilter(transactionFilter, status);
          if (includeCollections) applyStatusFilter(collectionFilter, status);
          break;
      }
    }

    // Include WalletTransactions for:
    // 1. All Accounts Report (when targetUserId/targetUserIds is provided)
    // 2. Self Wallet (when targetUserId/targetUserIds is provided)
    // 3. Account Reports (when accountId is provided - to show Add Amount/Withdraw for specific account)
    const includeWalletTransactions = (!targetUserId && !targetUserIds && !accountId) ? false : true;
    
    const walletTransactionFilter = includeWalletTransactions ? {
      type: { $in: ['add', 'withdraw', 'transaction'] },
      status: 'completed'
    } : null;
    
    // For self wallet(s), filter wallet transactions by userId(s)
    if (targetUserIds && targetUserIds.length > 1 && walletTransactionFilter) {
      // Multiple users: filter by all selected user IDs
      walletTransactionFilter.userId = { $in: targetUserIds };
    } else if (targetUserId && walletTransactionFilter) {
      // Single user: filter by single user ID
      walletTransactionFilter.userId = targetUserId;
    } else if (roleFilteredUserIds && walletTransactionFilter) {
      // Filter wallet transactions by users with the specified role
      walletTransactionFilter.userId = { $in: roleFilteredUserIds };
    }
    
    if (includeWalletTransactions && walletTransactionFilter) {
      // Apply date filter to wallet transactions
      if (Object.keys(dateRange).length) {
        walletTransactionFilter.createdAt = { ...dateRange };
      }
      
      // Apply mode filter if provided (from account filter or mode parameter)
      if (accountModeType) {
        walletTransactionFilter.mode = accountModeType;
      } else if (mode) {
        walletTransactionFilter.mode = mode;
      }
      
      // ========================================================================
      // WALLET TRANSACTIONS FILTERING - By accountId in notes
      // ========================================================================
      // When filtering by accountId, we filter wallet transactions by checking
      // if the accountId appears in the notes field. The notes format is:
      // "Amount added to account {accountId} by SuperAdmin" or
      // "Amount withdrawn from account {accountId} by SuperAdmin"
      //
      // This ensures:
      // - Sales UPI wallet transactions only show when Sales UPI is selected
      // - Purchase UPI wallet transactions only show when Purchase UPI is selected
      // - Complete separation of wallet transaction data between accounts
      // ========================================================================
      if (accountId) {
        const accountIdString = accountId.toString();
        // Escape special regex characters in accountId to prevent regex injection
        const escapedAccountId = accountIdString.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Match "account" followed by whitespace and then the exact accountId
        // The (?:\\s|$) ensures we match complete accountId, not partial matches
        walletTransactionFilter.notes = { 
          $regex: new RegExp(`account\\s+${escapedAccountId}(?:\\s|$)`, 'i')
        };
      }
    }

    // Log filters before querying
    console.log('\n🔍 FILTERS APPLIED:');
    console.log('   Expense Filter:', JSON.stringify(expenseFilter, null, 2));
    console.log('   Transaction Filter:', JSON.stringify(transactionFilter, null, 2));
    console.log('   Collection Filter:', JSON.stringify(collectionFilter, null, 2));
    if (walletTransactionFilter) {
      console.log('   Wallet Transaction Filter:', JSON.stringify(walletTransactionFilter, null, 2));
    }
    console.log('   Include Expenses:', includeExpenses);
    console.log('   Include Transactions:', includeTransactions);
    console.log('   Include Collections:', includeCollections);
    console.log('   Include Wallet Transactions:', includeWalletTransactions && walletTransactionFilter);
    console.log('');

    const [expenses, transactions, collections, walletTransactions] = await Promise.all([
      includeExpenses
        ? Expense.find(expenseFilter)
            .populate('userId', 'name email role')
            .populate('createdBy', 'name email role')
            .sort({ createdAt: -1 })
        : [],
      includeTransactions
        ? Transaction.find(transactionFilter)
            .populate('sender', 'name email role')
            .populate('receiver', 'name email role')
            .populate('initiatedBy', 'name email role')
            .populate('approvedBy', 'name email role')
            .sort({ createdAt: -1 })
        : [],
      includeCollections
        ? Collection.find(collectionFilter)
            .populate('collectedBy', 'name email role')
            .populate('from', 'name email role')
            .populate('assignedReceiver', 'name email role')
            .populate('approvedBy', 'name email role')
            .populate('paymentModeId', 'modeName description')
            .sort({ createdAt: -1 })
        : [],
      includeWalletTransactions && walletTransactionFilter
        ? WalletTransaction.find(walletTransactionFilter)
            .populate('userId', 'name email role')
            .populate('performedBy', 'name email role')
            .populate('fromUserId', 'name email')
            .populate('toUserId', 'name email')
            .populate('walletId')
            .sort({ createdAt: -1 })
        : []
    ]);

    console.log('📦 DATA RETRIEVED:');
    console.log('   Expenses:', expenses.length, 'records');
    console.log('   Transactions:', transactions.length, 'records');
    console.log('   Collections:', collections.length, 'records');
    console.log('   Wallet Transactions:', walletTransactions?.length || 0, 'records');
    console.log('');

    const transformedExpenses = expenses.map(exp => ({
      id: exp._id,
      type: 'Expenses',
      date: exp.createdAt,
      createdAt: exp.createdAt,
      userId: exp.userId ? {
        id: exp.userId._id,
        name: exp.userId.name,
        email: exp.userId.email,
        role: exp.userId.role
      } : null,
      createdBy: exp.createdBy ? {
        id: exp.createdBy._id,
        name: exp.createdBy.name,
        email: exp.createdBy.email,
        role: exp.createdBy.role
      } : null,
      from: exp.userId ? exp.userId.name : 'Unknown',
      to: '-',
      category: exp.category,
      amount: exp.amount,
      mode: exp.mode,
      description: exp.description || '',
      status: exp.status,
      proofUrl: exp.proofUrl || null,
      flagReason: exp.flagReason || null
    }));

    const transformedTransactions = transactions.map(tx => ({
      id: tx._id,
      type: 'Transactions',
      date: tx.createdAt,
      createdAt: tx.createdAt,
      sender: tx.sender ? {
        id: tx.sender._id,
        name: tx.sender.name,
        email: tx.sender.email,
        role: tx.sender.role
      } : null,
      receiver: tx.receiver ? {
        id: tx.receiver._id,
        name: tx.receiver.name,
        email: tx.receiver.email,
        role: tx.receiver.role
      } : null,
      initiatedBy: tx.initiatedBy ? {
        id: tx.initiatedBy._id,
        name: tx.initiatedBy.name,
        email: tx.initiatedBy.email,
        role: tx.initiatedBy.role
      } : null,
      approvedBy: tx.approvedBy ? {
        id: tx.approvedBy._id,
        name: tx.approvedBy.name,
        email: tx.approvedBy.email,
        role: tx.approvedBy.role
      } : null,
      createdBy: tx.initiatedBy ? {
        id: tx.initiatedBy._id,
        name: tx.initiatedBy.name,
        email: tx.initiatedBy.email,
        role: tx.initiatedBy.role
      } : null,
      from: tx.sender ? tx.sender.name : 'Unknown',
      to: tx.receiver ? tx.receiver.name : 'Unknown',
      amount: tx.amount,
      mode: tx.mode,
      purpose: tx.purpose || '',
      status: tx.status,
      proofUrl: tx.proofUrl || null,
      flagReason: tx.flagReason || null,
      isAutoPay: tx.isAutoPay,
      isSystemTransaction: tx.isSystemTransaction || false
    }));

    // Transform collections and ensure they match the selected account
    const transformedCollections = collections
      .map(col => {
        // ========================================================================
        // STRICT VALIDATION: Ensure collection belongs to selected account
        // ========================================================================
        // When filtering by accountId, we must ensure:
        // 1. Collection has a paymentModeId (not null/undefined)
        // 2. Collection's paymentModeId exactly matches the selected accountId
        // 3. Collections without paymentModeId are excluded
        // 4. Collections with different paymentModeId are excluded
        // ========================================================================
        if (accountId) {
          // Check if collection has paymentModeId
          if (!col.paymentModeId) {
            return null; // Exclude collections without paymentModeId
          }
          
          // Get paymentModeId from collection (handle both populated and non-populated)
          const collectionPaymentModeId = col.paymentModeId._id 
            ? col.paymentModeId._id.toString() 
            : (col.paymentModeId.toString ? col.paymentModeId.toString() : null);
          
          if (!collectionPaymentModeId) {
            return null; // Exclude if we can't get paymentModeId
          }
          
          const selectedAccountId = accountId.toString();
          
          // Only include collections that have the exact paymentModeId match
          if (collectionPaymentModeId !== selectedAccountId) {
            return null; // Exclude this collection - it doesn't belong to the selected account
          }
        }
        
        return {
          id: col._id,
          type: 'Collections',
          date: col.createdAt,
          createdAt: col.createdAt,
          collectedBy: col.collectedBy ? {
            id: col.collectedBy._id,
            name: col.collectedBy.name,
            email: col.collectedBy.email,
            role: col.collectedBy.role
          } : null,
          assignedReceiver: col.assignedReceiver ? {
            id: col.assignedReceiver._id,
            name: col.assignedReceiver.name,
            email: col.assignedReceiver.email,
            role: col.assignedReceiver.role
          } : null,
          approvedBy: col.approvedBy ? {
            id: col.approvedBy._id,
            name: col.approvedBy.name,
            email: col.approvedBy.email,
            role: col.approvedBy.role
          } : null,
          from: col.from ? {
            id: col.from._id,
            name: col.from.name,
            email: col.from.email,
            role: col.from.role
          } : (col.collectedBy ? {
            id: col.collectedBy._id,
            name: col.collectedBy.name,
            email: col.collectedBy.email,
            role: col.collectedBy.role
          } : null),
          createdBy: col.isSystemCollection || !col.collectedBy ? {
            id: null,
            name: 'System',
            email: null,
            role: 'System'
          } : (col.collectedBy ? {
            id: col.collectedBy._id,
            name: col.collectedBy.name,
            email: col.collectedBy.email,
            role: col.collectedBy.role
          } : null),
          paymentMode: col.paymentModeId ? {
            id: col.paymentModeId._id,
            modeName: col.paymentModeId.modeName,
            description: col.paymentModeId.description,
            autoPay: col.paymentModeId.autoPay
          } : null,
          voucherNumber: col.voucherNumber,
          customerName: col.customerName,
          from: col.from ? col.from.name : (col.collectedBy ? col.collectedBy.name : 'Unknown'),
          to: col.assignedReceiver ? col.assignedReceiver.name : 'Unknown',
          amount: col.amount,
          mode: col.mode,
          status: col.status,
          notes: col.notes || '',
          proofUrl: col.proofUrl || null,
          flagReason: col.flagReason || null,
          isAutoPay: col.paymentModeId?.autoPay && col.mode !== 'Cash'
        };
      })
      .filter(col => col !== null); // Remove null entries (collections that don't match)

    // Transform WalletTransactions (only for All Accounts Report)
    const transformedWalletTransactions = includeWalletTransactions && walletTransactions ? walletTransactions
      // Skip wallet ledger rows that already have a corresponding Transaction entry
      // so each transfer appears only once in the combined table.
      .filter(wt => (wt?.type || '').toLowerCase() !== 'transaction')
      .map(wt => {
        // Extract accountId from notes
        // Format: "Amount added to account {accountId} by SuperAdmin" or "Amount withdrawn from account {accountId} by SuperAdmin"
        let extractedAccountId = null;
        let accountName = 'Unknown Account';
        
        if (wt.notes) {
          // Try to extract accountId from notes
          const accountMatch = wt.notes.match(/account\s+([^\s]+)/i);
          if (accountMatch) {
            extractedAccountId = accountMatch[1];
            // Try to get account name from payment mode if available
            if (selectedPaymentMode && extractedAccountId === accountId) {
              accountName = selectedPaymentMode.modeName || selectedPaymentMode.description || extractedAccountId;
            } else {
              accountName = extractedAccountId;
            }
          }
        }
        
        // If no accountId in notes, use userId name as account identifier
        if (!extractedAccountId && wt.userId) {
          accountName = wt.userId.name || 'User Account';
        }
        
        // Determine transaction type display
        let typeDisplay;
        let fromName, toName;
        
        if (wt.type === 'transaction') {
          // For transaction type, use operation to determine display
          typeDisplay = 'Transaction';
          // Get sender and receiver names from related transaction or notes
          if (wt.fromUserId && wt.toUserId) {
            // If we have populated user IDs, use them
            const fromUser = wt.fromUserId.name || wt.fromUserId.email || 'Unknown';
            const toUser = wt.toUserId.name || wt.toUserId.email || 'Unknown';
            fromName = wt.operation === 'subtract' ? 'You' : fromUser;
            toName = wt.operation === 'add' ? 'You' : toUser;
          } else {
            // Fallback to notes or performer
            const performerName = wt.performedBy 
              ? (wt.performedBy.name || 'SuperAdmin')
              : 'SuperAdmin';
            fromName = wt.operation === 'subtract' ? 'You' : performerName;
            toName = wt.operation === 'add' ? 'You' : performerName;
          }
        } else {
          // For add/withdraw types
          typeDisplay = wt.type === 'add' ? 'Add Amount' : 'Withdraw';
          // Get performer name (SuperAdmin or whoever performed the action)
          const performerName = wt.performedBy 
            ? (wt.performedBy.name || 'SuperAdmin')
            : 'SuperAdmin';
          
          // Determine From → To display
          // Add Amount: SuperAdmin (performer) → XYZ Bank (account)
          // Withdraw: XYZ Bank (account) → SuperAdmin (performer)
          fromName = wt.type === 'add' ? performerName : accountName;
          toName = wt.type === 'add' ? accountName : performerName;
        }
        
        return {
          id: wt._id,
          type: typeDisplay, // 'Add Amount', 'Withdraw', or 'Transaction'
          date: wt.createdAt,
          createdAt: wt.createdAt,
          userId: wt.userId ? {
            id: wt.userId._id,
            name: wt.userId.name,
            email: wt.userId.email,
            role: wt.userId.role
          } : null,
          createdBy: wt.performedBy ? {
            id: wt.performedBy._id,
            name: wt.performedBy.name,
            email: wt.performedBy.email,
            role: wt.performedBy.role
          } : null,
          from: fromName,
          to: toName,
          amount: wt.amount,
          mode: wt.mode,
          status: 'Completed', // WalletTransactions are always completed when in report
          accountId: extractedAccountId,
          accountName: accountName,
          notes: wt.notes || '',
          operation: wt.operation, // 'add' or 'subtract'
          walletTransactionType: wt.type // Keep original type for reference
        };
      })
      .filter(wt => {
        // ========================================================================
        // STRICT WALLET TRANSACTION FILTERING - Double check accountId match
        // ========================================================================
        // Even though we filter by regex in the query, we do an additional strict check
        // here to ensure the extracted accountId matches the selected accountId.
        // This provides an extra layer of security to ensure complete data separation.
        // 
        // IMPORTANT: When filtering by accountId:
        // - Only include wallet transactions that have accountId in notes
        // - Only include wallet transactions where extracted accountId matches selected accountId
        // - Exclude wallet transactions without accountId in notes
        // - Exclude wallet transactions with different accountId
        // ========================================================================
        if (accountId) {
          // Check if wallet transaction has accountId
          if (!wt.accountId) {
            return false; // Exclude wallet transactions without accountId
          }
          
          // Only include wallet transactions where the extracted accountId exactly matches
          // the selected accountId. This ensures complete separation between accounts.
          const extractedAccountId = wt.accountId.toString();
          const selectedAccountId = accountId.toString();
          
          return extractedAccountId === selectedAccountId;
        }
        return true;
      }) : [];

    const combined = [
      ...transformedExpenses,
      ...transformedTransactions,
      ...transformedCollections,
      ...transformedWalletTransactions
    ].sort((a, b) => {
      const first = new Date(a.date || a.createdAt || 0).getTime();
      const second = new Date(b.date || b.createdAt || 0).getTime();
      return second - first;
    });

    // ============================================================================
    // SUMMARY CALCULATION - Account-specific cash flow
    // ============================================================================
    // Calculate cashIn and cashOut from the FILTERED data only. This ensures:
    // - When Sales UPI is selected: Summary shows ONLY Sales UPI's cash flow
    // - When Purchase UPI is selected: Summary shows ONLY Purchase UPI's cash flow
    // - Each account has its own separate summary with no data mixing
    //
    // IMPORTANT: When targetUserId is provided (single user selected in All Wallet Report):
    // - This calculation MUST match the Self Wallet view exactly
    // - Cash In = Collections (accounted/approved) + Transactions (received) + Wallet Add
    // - Cash Out = Expenses (approved) + Transactions (sent) + Wallet Withdraw
    // - Balance = wallet.totalBalance from database (same as Self Wallet)
    // - This ensures consistency between All Wallet Report (user filter) and Self Wallet view
    //
    // IMPORTANT: When targetUserIds is provided (multiple users selected in All Wallet Report):
    // - This calculation sums up each selected user's self wallet values
    // - Cash In = Sum of all selected users' Cash In (Collections + Transactions received + Wallet Add)
    // - Cash Out = Sum of all selected users' Cash Out (Expenses + Transactions sent + Wallet Withdraw)
    // - Balance = Sum of all selected users' wallet.totalBalance from database
    // - This gives the combined total of all selected users' self wallets
    // ============================================================================
    let cashIn = 0;
    let cashOut = 0;

    // Add wallet transactions to cash flow
    // Note: For account filtering, wallet transactions are counted here
    // For self wallet, multiple users, and role filtering, wallet transactions are counted in the combined.forEach loop
    // to avoid double counting
    if (includeWalletTransactions && walletTransactions && !targetUserId && !targetUserIds && !roleFilteredUserIds) {
      // Count wallet transactions here for:
      // - All Accounts view (no filters)
      // - Account filter view (accountId set)
      // Self wallet, multiple users, and role filter wallet transactions are counted in combined.forEach loop
      walletTransactions.forEach(wt => {
        const amount = toSafeNumber(wt.amount);
        if (wt.type === 'add') {
          cashIn += amount;
        } else if (wt.type === 'withdraw') {
          cashOut += amount;
        }
      });
    }

    const breakdown = {
      Expenses: {
        Approved: { count: 0, amount: 0 },
        Unapproved: { count: 0, amount: 0 },
        Flagged: { count: 0, amount: 0 },
        Rejected: { count: 0, amount: 0 }
      },
      Transactions: {
        Approved: { count: 0, amount: 0 },
        Unapproved: { count: 0, amount: 0 },
        Flagged: { count: 0, amount: 0 },
        Rejected: { count: 0, amount: 0 }
      },
      Collections: {
        Accounted: { count: 0, amount: 0 },
        Unaccounted: { count: 0, amount: 0 },
        Flagged: { count: 0, amount: 0 },
        Rejected: { count: 0, amount: 0 }
      }
    };

    const incrementBreakdown = (category, key, amount) => {
      const entry = breakdown[category] && breakdown[category][key];
      if (!entry) return;
      entry.count += 1;
      entry.amount += amount;
    };

    console.log('📊 COMBINED DATA:', combined.length, 'items after filtering and transformation');
    console.log('   Breakdown by type:');
    const typeBreakdown = combined.reduce((acc, item) => {
      acc[item.type] = (acc[item.type] || 0) + 1;
      return acc;
    }, {});
    console.log('   ', JSON.stringify(typeBreakdown, null, 2));
    console.log('');

    // ============================================================================
    // SUMMARY CALCULATION FROM COMBINED DATA
    // ============================================================================
    // The 'combined' array contains ONLY the filtered data:
    // - Collections filtered by paymentModeId (exact match)
    // - Wallet transactions filtered by accountId in notes
    // - Expenses/Transactions excluded when filtering by accountId
    //
    // IMPORTANT: When a new payment mode is selected with no data:
    // - Collections array will be empty (no collections with that paymentModeId)
    // - Wallet transactions array will be empty (no transactions with that accountId)
    // - Summary will correctly show: cashIn = 0, cashOut = 0, balance = 0
    //
    // Therefore, the summary calculation automatically reflects only the
    // selected account's data, ensuring complete separation and correct zero values
    // for new payment modes with no transactions.
    //
    // NOTE: When filtering by single user (targetUserId) without accountId filter,
    // we will use stored wallet.cashIn and wallet.cashOut values instead of calculating.
    // ============================================================================
    console.log('💰 CALCULATING SUMMARY FROM COMBINED DATA...');
    console.log('   [NOTE: Initial values come from wallet transactions for "all users" view]');
    console.log('   Initial values - CashIn:', cashIn, ', CashOut:', cashOut);
    
    let collectionCashIn = 0;
    let expenseCashOut = 0;
    let transactionCashIn = 0;
    let transactionCashOut = 0;
    let walletTxnCashIn = 0;
    let walletTxnCashOut = 0;
    
    combined.forEach(item => {
      const amount = toSafeNumber(item.amount);
      const normalized = normalizeStatusKey(item.status);

      // Collections: Already filtered by paymentModeId, so only this account's
      // collections are included in the summary
      if (item.type === 'Collections') {
        if (normalized === 'accounted' || normalized === 'approved') {
          cashIn += amount;
          collectionCashIn += amount;
          incrementBreakdown('Collections', 'Accounted', amount);
        } else if (normalized === 'flagged') {
          incrementBreakdown('Collections', 'Flagged', amount);
        } else if (normalized === 'rejected') {
          incrementBreakdown('Collections', 'Rejected', amount);
        } else {
          incrementBreakdown('Collections', 'Unaccounted', amount);
        }
      } else if (item.type === 'Expenses') {
        if (normalized === 'approved') {
          cashOut += amount;
          expenseCashOut += amount;
          incrementBreakdown('Expenses', 'Approved', amount);
        } else if (normalized === 'flagged') {
          incrementBreakdown('Expenses', 'Flagged', amount);
        } else if (normalized === 'rejected') {
          incrementBreakdown('Expenses', 'Rejected', amount);
        } else {
          incrementBreakdown('Expenses', 'Unapproved', amount);
        }
      } else if (item.type === 'Transactions') {
        // IMPORTANT TRANSACTION LOGIC FOR ALL USERS:
        // - Only 'approved' or 'completed' transactions affect Cash In/Cash Out
        // - 'pending', 'flagged', 'rejected', 'cancelled' transactions are NOT counted
        // - When user is RECEIVER: Transaction amount = Cash In
        // - When user is SENDER: Transaction amount = Cash Out
        // - If transaction is rejected/cancelled after approval, wallet is reversed (handled in transactionController)
        // - This logic applies consistently to ALL users in the system
        // Calculate cash in/out based on user's role (sender or receiver)
        if (normalized === 'approved' || normalized === 'completed') {
          if (targetUserIds && targetUserIds.length > 1) {
            // Multiple users selected: Calculate cash flow for all selected users
            // Sum of each user's self wallet transaction values
            const senderId = item.sender?._id?.toString() || item.sender?.id?.toString() || item.sender?.toString();
            const receiverId = item.receiver?._id?.toString() || item.receiver?.id?.toString() || item.receiver?.toString();
            
            const senderInSelected = targetUserIds.some(id => id.toString() === senderId);
            const receiverInSelected = targetUserIds.some(id => id.toString() === receiverId);
            
            if (receiverInSelected && !senderInSelected) {
              // Selected user received money from outside (cash in)
              cashIn += amount;
              transactionCashIn += amount;
            } else if (senderInSelected && !receiverInSelected) {
              // Selected user sent money to outside (cash out)
              cashOut += amount;
              transactionCashOut += amount;
            }
            // If both sender and receiver are in selected users, it's internal transfer - don't count
          } else if (targetUserId) {
            // For self wallet OR All Wallet Report with single user filter: check if user is sender or receiver
            // This calculation MUST match Self Wallet view exactly
            const senderId = item.sender?._id?.toString() || item.sender?.id?.toString() || item.sender?.toString();
            const receiverId = item.receiver?._id?.toString() || item.receiver?.id?.toString() || item.receiver?.toString();
            const userIdStr = targetUserId.toString();
            
            if (receiverId === userIdStr) {
              // User received money (cash in) - same calculation as Self Wallet
              cashIn += amount;
              transactionCashIn += amount;
            } else if (senderId === userIdStr) {
              // User sent money (cash out) - same calculation as Self Wallet
              cashOut += amount;
              transactionCashOut += amount;
            }
          } else if (roleFilteredUserIds) {
            // Role filter: Calculate net cash flow for users with this role
            const senderId = item.sender?._id?.toString() || item.sender?.id?.toString() || item.sender?.toString();
            const receiverId = item.receiver?._id?.toString() || item.receiver?.id?.toString() || item.receiver?.toString();
            
            const senderInRole = roleFilteredUserIds.some(id => id.toString() === senderId);
            const receiverInRole = roleFilteredUserIds.some(id => id.toString() === receiverId);
            
            if (receiverInRole && !senderInRole) {
              // User with this role received money (cash in)
              cashIn += amount;
              transactionCashIn += amount;
            } else if (senderInRole && !receiverInRole) {
              // User with this role sent money (cash out)
              cashOut += amount;
              transactionCashOut += amount;
            }
            // If both sender and receiver are in the role, it's an internal transfer - don't count
          } else {
            // For "all users" view: Transactions don't affect overall cash in/out
            // because one user's cash out = another user's cash in
            // They cancel out in the overall system view
            // We don't count them in summary for "all users" view
            // (Collections and Expenses are the actual cash flows)
          }
        }
        
        if (normalized === 'approved' || normalized === 'completed') {
          incrementBreakdown('Transactions', 'Approved', amount);
        } else if (normalized === 'flagged') {
          incrementBreakdown('Transactions', 'Flagged', amount);
        } else if (normalized === 'rejected') {
          incrementBreakdown('Transactions', 'Rejected', amount);
        } else {
          incrementBreakdown('Transactions', 'Unapproved', amount);
        }
      } else if (item.type === 'Add Amount' || item.type === 'Withdraw' || item.type === 'Transaction') {
        // Handle wallet transactions (Add Amount / Withdraw / Transaction)
        if (normalized === 'completed') {
          const walletTransactionType = item.walletTransactionType || item.type?.toLowerCase();
          
          if (targetUserIds && targetUserIds.length > 1) {
            // Multiple users selected: Count wallet transactions for all selected users
            // Sum of each user's self wallet transaction values
            const wtUserId = item.userId?._id?.toString() || item.userId?.id?.toString() || item.userId?.toString();
            const isWtUserInSelected = targetUserIds.some(id => id.toString() === wtUserId);
            
            if (isWtUserInSelected) {
              if (walletTransactionType === 'add' || (walletTransactionType === 'transaction' && item.operation === 'add')) {
                cashIn += amount;
                walletTxnCashIn += amount;
              } else if (walletTransactionType === 'withdraw' || (walletTransactionType === 'transaction' && item.operation === 'subtract')) {
                cashOut += amount;
                walletTxnCashOut += amount;
              }
            }
          } else if (targetUserId) {
            // For self wallet OR All Wallet Report with single user filter: count wallet transactions
            // This calculation MUST match Self Wallet view exactly
            if (walletTransactionType === 'add' || (walletTransactionType === 'transaction' && item.operation === 'add')) {
              cashIn += amount;
              walletTxnCashIn += amount;
            } else if (walletTransactionType === 'withdraw' || (walletTransactionType === 'transaction' && item.operation === 'subtract')) {
              cashOut += amount;
              walletTxnCashOut += amount;
            }
          } else if (roleFilteredUserIds) {
            // For role-filtered view: count wallet transactions for users in the role
            const wtUserId = item.userId?._id?.toString() || item.userId?.id?.toString() || item.userId?.toString();
            const isWtUserInRole = roleFilteredUserIds.some(id => id.toString() === wtUserId);
            
            if (isWtUserInRole) {
              if (walletTransactionType === 'add' || (walletTransactionType === 'transaction' && item.operation === 'add')) {
                cashIn += amount;
                walletTxnCashIn += amount;
              } else if (walletTransactionType === 'withdraw' || (walletTransactionType === 'transaction' && item.operation === 'subtract')) {
                cashOut += amount;
                walletTxnCashOut += amount;
              }
            }
          } else {
            // For "all users" view: Wallet transactions are already counted in initial values
            // (from walletTransactions array before the combined loop)
            // But we still track them in the breakdown for debugging
            if (walletTransactionType === 'add' || (walletTransactionType === 'transaction' && item.operation === 'add')) {
              walletTxnCashIn += amount;
            } else if (walletTransactionType === 'withdraw' || (walletTransactionType === 'transaction' && item.operation === 'subtract')) {
              walletTxnCashOut += amount;
            }
          }
        }
      }
    });

    console.log('   Summary by type:');
    console.log('     Collections CashIn:', collectionCashIn, '[Shows in: Wallet Overview - Cash In card]');
    console.log('     Expenses CashOut:', expenseCashOut, '[Shows in: Wallet Overview - Cash Out card]');
    console.log('     Transactions CashIn:', transactionCashIn, '[Only counted for self wallet view]');
    console.log('     Transactions CashOut:', transactionCashOut, '[Only counted for self wallet view]');
    console.log('     Wallet Transactions CashIn:', walletTxnCashIn, '[Shows in: Wallet Overview - Cash In card (for self wallet)]');
    console.log('     Wallet Transactions CashOut:', walletTxnCashOut, '[Shows in: Wallet Overview - Cash Out card (for self wallet)]');
    if (!targetUserId) {
      console.log('     [NOTE: For "all users" view, wallet transactions are in initial values above]');
    }

    console.log('   After combined.forEach:');
    console.log('   CashIn:', cashIn);
    console.log('   CashOut:', cashOut);
    console.log('   Balance:', cashIn - cashOut);
    console.log('');
    
    // Log breakdown calculation for status count table
    console.log('📋 STATUS BREAKDOWN CALCULATION [Shows in: Status Count Table]:');
    console.log('   Expenses:');
    console.log('     Approved:', breakdown.Expenses.Approved.count, 'items, ₹', breakdown.Expenses.Approved.amount);
    console.log('     Unapproved:', breakdown.Expenses.Unapproved.count, 'items, ₹', breakdown.Expenses.Unapproved.amount);
    console.log('     Flagged:', breakdown.Expenses.Flagged.count, 'items, ₹', breakdown.Expenses.Flagged.amount);
    console.log('     Rejected:', breakdown.Expenses.Rejected.count, 'items, ₹', breakdown.Expenses.Rejected.amount);
    console.log('   Transactions:');
    console.log('     Approved:', breakdown.Transactions.Approved.count, 'items, ₹', breakdown.Transactions.Approved.amount);
    console.log('     Unapproved:', breakdown.Transactions.Unapproved.count, 'items, ₹', breakdown.Transactions.Unapproved.amount);
    console.log('     Flagged:', breakdown.Transactions.Flagged.count, 'items, ₹', breakdown.Transactions.Flagged.amount);
    console.log('     Rejected:', breakdown.Transactions.Rejected.count, 'items, ₹', breakdown.Transactions.Rejected.amount);
    console.log('   Collections:');
    console.log('     Accounted:', breakdown.Collections.Accounted.count, 'items, ₹', breakdown.Collections.Accounted.amount);
    console.log('     Unaccounted:', breakdown.Collections.Unaccounted.count, 'items, ₹', breakdown.Collections.Unaccounted.amount);
    console.log('     Flagged:', breakdown.Collections.Flagged.count, 'items, ₹', breakdown.Collections.Flagged.amount);
    console.log('     Rejected:', breakdown.Collections.Rejected.count, 'items, ₹', breakdown.Collections.Rejected.amount);
    console.log('');

    let walletSummary = null;
    let wallet = null;

    if (targetUserIds && targetUserIds.length > 1) {
      // Multiple users selected: Sum up each user's wallet balance
      // This gives us the combined balance of all selected users' self wallets
      const Wallet = require('../models/walletModel');
      const wallets = await Wallet.find({ userId: { $in: targetUserIds } });
      
      walletSummary = wallets.reduce(
        (acc, current) => {
          acc.cashBalance += current.cashBalance;
          acc.upiBalance += current.upiBalance;
          acc.bankBalance += current.bankBalance;
          acc.totalBalance += current.totalBalance;
          acc.cashIn = (acc.cashIn || 0) + (current.cashIn || 0);
          acc.cashOut = (acc.cashOut || 0) + (current.cashOut || 0);
          return acc;
        },
        { cashBalance: 0, upiBalance: 0, bankBalance: 0, totalBalance: 0, cashIn: 0, cashOut: 0 }
      );
      walletSummary.walletCount = wallets.length;
      walletSummary.selectedUserIds = targetUserIds.map(id => id.toString());
      
      console.log(`💰 Multiple Users Wallet Summary: ${targetUserIds.length} users`);
      console.log(`   Total Balance: ₹${walletSummary.totalBalance}`);
      console.log(`   Cash: ₹${walletSummary.cashBalance}, UPI: ₹${walletSummary.upiBalance}, Bank: ₹${walletSummary.bankBalance}`);
    } else if (targetUserId) {
      const walletDoc = await getOrCreateWallet(targetUserId);
      // Check if wallet document actually has cashIn/cashOut fields (not just defaulted)
      const hasCashInField = walletDoc.cashIn !== undefined && walletDoc.cashIn !== null;
      const hasCashOutField = walletDoc.cashOut !== undefined && walletDoc.cashOut !== null;
      
      wallet = {
        _id: walletDoc._id,
        userId: walletDoc.userId,
        cashBalance: walletDoc.cashBalance,
        upiBalance: walletDoc.upiBalance,
        bankBalance: walletDoc.bankBalance,
        totalBalance: walletDoc.totalBalance,
        cashIn: hasCashInField ? (walletDoc.cashIn || 0) : undefined,
        cashOut: hasCashOutField ? (walletDoc.cashOut || 0) : undefined,
        updatedAt: walletDoc.updatedAt,
        createdAt: walletDoc.createdAt
      };
      
      console.log('💼 Wallet document check:');
      console.log('   cashIn field exists:', hasCashInField, ', value:', walletDoc.cashIn);
      console.log('   cashOut field exists:', hasCashOutField, ', value:', walletDoc.cashOut);
    } else if (roleFilteredUserIds) {
      // Role filter: Get wallets for all users with the specified role
      const wallets = await Wallet.find({ userId: { $in: roleFilteredUserIds } });
      walletSummary = wallets.reduce(
        (acc, current) => {
          acc.cashBalance += current.cashBalance;
          acc.upiBalance += current.upiBalance;
          acc.bankBalance += current.bankBalance;
          acc.totalBalance += current.totalBalance;
          acc.cashIn = (acc.cashIn || 0) + (current.cashIn || 0);
          acc.cashOut = (acc.cashOut || 0) + (current.cashOut || 0);
          return acc;
        },
        { cashBalance: 0, upiBalance: 0, bankBalance: 0, totalBalance: 0, cashIn: 0, cashOut: 0 }
      );
      walletSummary.walletCount = wallets.length;
    } else {
      // All users: Get all wallets
      const wallets = await Wallet.find();
      walletSummary = wallets.reduce(
        (acc, current) => {
          acc.cashBalance += current.cashBalance;
          acc.upiBalance += current.upiBalance;
          acc.bankBalance += current.bankBalance;
          acc.totalBalance += current.totalBalance;
          acc.cashIn = (acc.cashIn || 0) + (current.cashIn || 0);
          acc.cashOut = (acc.cashOut || 0) + (current.cashOut || 0);
          return acc;
        },
        { cashBalance: 0, upiBalance: 0, bankBalance: 0, totalBalance: 0, cashIn: 0, cashOut: 0 }
      );
      walletSummary.walletCount = wallets.length;
    }

    // Include account information if filtered by account
    const accountInfo = selectedPaymentMode ? {
      id: selectedPaymentMode._id,
      modeName: selectedPaymentMode.modeName,
      description: selectedPaymentMode.description,
      mode: accountModeType,
      isActive: selectedPaymentMode.isActive
    } : null;

    // ============================================================================
    // RESPONSE STRUCTURE - Account-specific filtering
    // ============================================================================
    // When accountId is provided, the response contains:
    // - data: Only collections and wallet transactions for the selected account
    // - summary: Cash flow calculated from ONLY the selected account's data
    // - account: Information about the selected payment mode account
    // - breakdown: Status breakdown for the selected account's data only
    //
    // This ensures complete data separation - each account has its own isolated data
    // ============================================================================
    
    // Log filtering details for debugging (only in development)
    if (accountId && process.env.NODE_ENV !== 'production') {
      console.log(`[Account Filter] Filtering by accountId: ${accountId}`);
      console.log(`[Account Filter] Collections found: ${collections.length}`);
      console.log(`[Account Filter] Wallet transactions found: ${walletTransactions?.length || 0}`);
      console.log(`[Account Filter] Filtered collections: ${transformedCollections.length}`);
      console.log(`[Account Filter] Filtered wallet transactions: ${transformedWalletTransactions.length}`);
      console.log(`[Account Filter] Summary - CashIn: ${cashIn}, CashOut: ${cashOut}, Balance: ${cashIn - cashOut}`);
    }

    // Calculate balance from cash flow
    // Priority order:
    // 1. Account Reports (accountId provided): Use calculated balance (cashIn - cashOut)
    // 2. Multiple users (targetUserIds with length > 1): Use sum of all selected users' wallet.totalBalance
    // 3. Self wallet (targetUserId provided): Use wallet.totalBalance
    // 4. Role filter (roleFilteredUserIds): Use walletSummary.totalBalance (sum of wallets for users with this role)
    // 5. All users view (no targetUserId, no targetUserIds, no roleFilter): Use walletSummary.totalBalance (sum of all wallets)
    let finalBalance;
    
    if (accountId) {
      // Account Reports: Always use calculated balance (cashIn - cashOut)
      // This ensures balance reflects only the selected account's transactions
      finalBalance = cashIn - cashOut;
      console.log('📊 Account Report - Using calculated balance from account transactions:', finalBalance);
    } else if (targetUserIds && targetUserIds.length > 1) {
      // Multiple users selected: Use sum of all selected users' wallet balances
      // This gives us the combined balance of all selected users' self wallets
      if (walletSummary && walletSummary.totalBalance !== undefined) {
        finalBalance = walletSummary.totalBalance;
        console.log(`💼 Multiple Users (${targetUserIds.length} users) - Using sum of wallet.totalBalance:`, finalBalance);
        console.log('   [NOTE: This is the sum of each selected user\'s self wallet balance]');
      } else {
        // Fallback: Use calculated balance if walletSummary not available
        finalBalance = cashIn - cashOut;
        console.log('💼 Multiple Users - WalletSummary not available, using calculated balance:', finalBalance);
      }
    } else if (targetUserId) {
      // Self wallet OR All Wallet Report with single user filter: Use actual wallet balance from database
      // This ensures the balance shown in All Wallet Report (when user is selected) matches
      // exactly with the Self Wallet view for that user
      if (wallet && wallet.totalBalance !== undefined) {
        finalBalance = wallet.totalBalance;
        console.log('💼 Self wallet / All Wallet Report (single user filter) - Using wallet.totalBalance:', finalBalance);
        console.log('   [NOTE: This ensures consistency with Self Wallet view]');
      } else {
        finalBalance = 0;
        console.log('💼 Self wallet / All Wallet Report (single user filter) - Wallet not found, using 0');
      }
    } else if (roleFilteredUserIds) {
      // Role filter: Use sum of wallets for users with this role
      if (walletSummary && walletSummary.totalBalance !== undefined) {
        finalBalance = walletSummary.totalBalance;
        console.log('📊 Role filter report - Using sum of wallets for users with role:', finalBalance, '(from', walletSummary.walletCount || 0, 'wallets)');
      } else {
        // Fallback: Use calculated balance if walletSummary not available
        finalBalance = cashIn - cashOut;
        console.log('📊 Role filter report - WalletSummary not available, using calculated balance:', finalBalance);
      }
    } else {
      // All users view: Use sum of all wallets' totalBalance
      if (walletSummary && walletSummary.totalBalance !== undefined) {
        finalBalance = walletSummary.totalBalance;
        console.log('📊 All wallet report - Using sum of all wallets totalBalance:', finalBalance, '(from', walletSummary.walletCount || 0, 'wallets)');
      } else {
        // Fallback: Use calculated balance if walletSummary not available
        finalBalance = cashIn - cashOut;
        console.log('📊 All wallet report - WalletSummary not available, using calculated balance:', finalBalance);
      }
    }

    // Determine filter mode and get user/role info
    const filterMode = targetUserIds && targetUserIds.length > 1 ? 'multipleUsers' : 
                      (targetUserId ? 'user' : (roleFilteredUserIds ? 'role' : 'all'));
    let userInfo = null;
    let usersInfo = null; // Array of user info for multiple users
    let roleInfo = null;
    
    if (targetUserIds && targetUserIds.length > 1) {
      // Multiple users selected: Get info for all selected users
      const User = require('../models/userModel');
      const users = await User.find({ _id: { $in: targetUserIds } }).select('name email role');
      usersInfo = users.map(user => ({
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }));
      console.log(`👥 Multiple Users Info: ${usersInfo.length} users selected`);
    } else if (targetUserId) {
      const User = require('../models/userModel');
      const user = await User.findById(targetUserId).select('name email role');
      if (user) {
        userInfo = {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role
        };
      }
    } else if (roleFilteredUserIds) {
      roleInfo = {
        role: userRole.trim(),
        userCount: roleFilteredUserIds.length
      };
    }

    // Use stored wallet cashIn/cashOut when filtering by single user (unless account filter is active)
    let finalCashIn = cashIn;
    let finalCashOut = cashOut;
    
    if (targetUserId && !accountId) {
      // Single user filter without account filter: Use stored wallet values
      if (wallet) {
        // Check if wallet has cashIn/cashOut fields (they might be undefined if migration not run)
        if (wallet.cashIn !== undefined && wallet.cashOut !== undefined) {
          finalCashIn = wallet.cashIn || 0;
          finalCashOut = wallet.cashOut || 0;
          console.log('💼 Using stored wallet cashIn/cashOut values:', finalCashIn, '/', finalCashOut);
        } else {
          // Fallback: If wallet doesn't have cashIn/cashOut fields, use calculated values
          console.log('⚠️  Wallet does not have cashIn/cashOut fields, using calculated values');
          console.log('   Calculated cashIn:', cashIn, ', cashOut:', cashOut);
          console.log('   NOTE: Run migration script to populate cashIn/cashOut fields: node scripts/migrate-wallet-cashin-cashout.js');
          finalCashIn = cashIn;
          finalCashOut = cashOut;
        }
      } else {
        // Wallet not found, use calculated values
        console.log('⚠️  Wallet not found, using calculated values');
        finalCashIn = cashIn;
        finalCashOut = cashOut;
      }
    } else if (targetUserIds && targetUserIds.length > 1 && !accountId) {
      // Multiple users filter without account filter: Use sum of stored wallet values
      if (walletSummary && walletSummary.cashIn !== undefined && walletSummary.cashOut !== undefined) {
        finalCashIn = walletSummary.cashIn || 0;
        finalCashOut = walletSummary.cashOut || 0;
        console.log('💼 Using sum of stored wallet cashIn/cashOut values:', finalCashIn, '/', finalCashOut);
      }
    } else if (roleFilteredUserIds && !accountId) {
      // Role filter without account filter: Use sum of stored wallet values
      if (walletSummary && walletSummary.cashIn !== undefined && walletSummary.cashOut !== undefined) {
        finalCashIn = walletSummary.cashIn || 0;
        finalCashOut = walletSummary.cashOut || 0;
        console.log('💼 Using sum of stored wallet cashIn/cashOut values for role:', finalCashIn, '/', finalCashOut);
      }
    }
    // If accountId is set, we use calculated values (account-specific filtering)

    const finalSummary = {
      cashIn: finalCashIn,
      cashOut: finalCashOut,
      balance: finalBalance
    };

    // ============================================================================
    // DETAILED SUMMARY CALCULATION BREAKDOWN - For Verification
    // ============================================================================
    console.log('\n📊 ===== SUMMARY CALCULATION BREAKDOWN =====');
    console.log('   Applied Filters:');
    console.log('     - User Role:', userRole || 'All');
    if (targetUserIds && targetUserIds.length > 1) {
      console.log('     - User IDs:', targetUserIds.map(id => id.toString()).join(', '), `(${targetUserIds.length} users)`);
    } else {
      console.log('     - User ID:', targetUserId ? targetUserId.toString() : 'All');
    }
    console.log('     - Status:', status || 'All');
    console.log('     - Type:', type || 'All');
    console.log('     - Mode:', mode || 'All');
    console.log('     - Account ID:', accountId || 'All');
    console.log('     - Date Range:', startDate && endDate ? `${startDate} to ${endDate}` : 'All');
    if (roleFilteredUserIds) {
      console.log('     - Users with Role:', roleFilteredUserIds.length, 'users');
    }
    console.log('');
    console.log('   Data Counts (After Filtering):');
    console.log('     - Collections:', collections.length);
    console.log('     - Expenses:', expenses.length);
    console.log('     - Transactions:', transactions.length);
    console.log('     - Wallet Transactions:', walletTransactions?.length || 0);
    console.log('     - Combined Items:', combined.length);
    console.log('');
    console.log('   Calculated Summary Values:');
    console.log('     - Cash In:', cashIn, '(from Collections + Wallet Transactions)');
    console.log('     - Cash Out:', cashOut, '(from Expenses + Wallet Transactions)');
    console.log('     - Calculated Balance (cashIn - cashOut):', cashIn - cashOut);
    console.log('');
    console.log('   Wallet Summary:');
    if (targetUserIds && targetUserIds.length > 1) {
      console.log('     - Filter Mode: Multiple Users');
      console.log('     - User Count:', targetUserIds.length);
      console.log('     - Combined Wallet Balance:', walletSummary?.totalBalance || 0);
    } else if (targetUserId) {
      console.log('     - Filter Mode: Self Wallet');
      console.log('     - Wallet Balance:', wallet?.totalBalance || 0);
    } else if (roleFilteredUserIds) {
      console.log('     - Filter Mode: Role Filter');
      console.log('     - Wallet Count:', walletSummary?.walletCount || 0);
      console.log('     - Total Wallet Balance:', walletSummary?.totalBalance || 0);
    } else {
      console.log('     - Filter Mode: All Users');
      console.log('     - Wallet Count:', walletSummary?.walletCount || 0);
      console.log('     - Total Wallet Balance:', walletSummary?.totalBalance || 0);
    }
    console.log('');
    console.log('   Final Summary (Sent to Frontend):');
    console.log('     - Cash In:', finalSummary.cashIn);
    console.log('     - Cash Out:', finalSummary.cashOut);
    console.log('     - Balance:', finalSummary.balance);
    console.log('=====================================\n');

    res.status(200).json({
      success: true,
      count: combined.length,
      data: combined,
      wallet,
      walletSummary,
      summary: finalSummary,
      breakdown,
      account: accountInfo,
      filterMode, // 'all', 'user', 'multipleUsers', or 'role' - indicates filter type
      userInfo, // User object when filtering by single user, null otherwise
      usersInfo, // Array of user objects when filtering by multiple users, null otherwise
      roleInfo, // Role info when filtering by role, null otherwise
      // Include filtering metadata for debugging
      _meta: accountId ? {
        filteredByAccount: true,
        accountId: accountId.toString(),
        accountName: selectedPaymentMode?.modeName || 'Unknown'
      } : {
        filteredByAccount: false
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get self wallet report (logged-in user's own wallet only)
// @route   GET /api/wallet/report/self
// @access  Private (any authenticated user)
exports.getSelfWalletReport = async (req, res) => {
  try {
    console.log('\n👤 ===== SELF WALLET REPORT REQUEST =====');
    console.log('   Timestamp:', new Date().toISOString());
    console.log('   User:', req.user.email, `(${req.user.role})`);
    console.log('   User ID:', req.user._id.toString());
    console.log('   Query Params:', {
      startDate: req.query.startDate || 'none',
      endDate: req.query.endDate || 'none',
      mode: req.query.mode || 'none',
      type: req.query.type || 'none',
      status: req.query.status || 'none'
    });
    console.log('=====================================\n');

    // Get logged-in user ID (security: users can only see their own data)
    // CRITICAL: Ensure userId is properly converted to ObjectId for consistent querying
    const userId = req.user._id;
    const userIdObjectId = mongoose.Types.ObjectId.isValid(userId) ? (typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId) : userId;
    
    console.log('🔐 [SELF WALLET] Security Check - Logged-in User ID:', userId.toString());
    console.log('🔐 [SELF WALLET] User Email:', req.user.email, ', Role:', req.user.role);

    // Extract query parameters
    const {
      startDate,
      endDate,
      mode,
      type,
      status
    } = req.query;

    // Self wallet doesn't support account filtering - always false
    const isFilteringBySpecificAccount = false;

    // Build date range filter
    const dateRange = {};
    if (startDate) {
      const parsedStart = new Date(startDate);
      if (!Number.isNaN(parsedStart.getTime())) {
        dateRange.$gte = parsedStart;
      }
    }
    if (endDate) {
      const parsedEnd = new Date(endDate);
      if (!Number.isNaN(parsedEnd.getTime())) {
        parsedEnd.setHours(23, 59, 59, 999);
        dateRange.$lte = parsedEnd;
      }
    }

    // Initialize filters
    // CRITICAL: Use userIdObjectId to ensure proper MongoDB query matching
    const expenseFilter = { userId: userIdObjectId }; // Only expenses owned by the user
    const transactionFilter = {
      $or: [
        { sender: userIdObjectId },      // User sent money
        { receiver: userIdObjectId }     // User received money
      ]
    };
    const collectionFilter = {
      $or: [
        { collectedBy: userIdObjectId },           // User collected money
        { assignedReceiver: userIdObjectId }       // Money assigned to user
      ]
    };
    // IMPORTANT: Always filter wallet transactions by 'completed' status
    // This ensures consistency between filtered data and TOTAL calculations
    // Only completed wallet transactions should be counted in cash flow
    const walletTransactionFilter = { userId: userIdObjectId, status: 'completed' };

    // Apply date range filters
    if (Object.keys(dateRange).length > 0) {
      expenseFilter.createdAt = { ...dateRange };
      transactionFilter.createdAt = { ...dateRange };
      collectionFilter.createdAt = { ...dateRange };
      walletTransactionFilter.createdAt = { ...dateRange };
    }

    // Apply mode filter (Cash, UPI, Bank)
    if (mode && mode !== 'All' && mode.trim() !== '') {
      expenseFilter.mode = mode.trim();
      transactionFilter.mode = mode.trim();
      collectionFilter.mode = mode.trim();
      walletTransactionFilter.mode = mode.trim();
    }

    // Apply status filter
    if (status && status.trim() !== '') {
      const normalizedStatus = normalizeStatusKey(status.trim());
      
      if (normalizedStatus === 'approved' || normalizedStatus === 'accounted') {
        expenseFilter.status = { $in: ['Approved', 'Completed'] };
        transactionFilter.status = { $in: ['Approved', 'Completed'] };
        collectionFilter.status = { $in: ['Approved', 'Verified'] };
      } else if (normalizedStatus === 'unapproved' || normalizedStatus === 'unaccounted') {
        expenseFilter.status = { $nin: ['Approved', 'Completed'] };
        transactionFilter.status = { $nin: ['Approved', 'Completed'] };
        collectionFilter.status = { $nin: ['Approved', 'Verified'] };
      } else if (normalizedStatus === 'flagged') {
        expenseFilter.status = 'Flagged';
        transactionFilter.status = 'Flagged';
        collectionFilter.status = 'Flagged';
      } else if (normalizedStatus === 'rejected') {
        expenseFilter.status = 'Rejected';
        transactionFilter.status = 'Rejected';
        collectionFilter.status = 'Rejected';
      } else {
        // Apply status as-is
        expenseFilter.status = status.trim();
        transactionFilter.status = status.trim();
        collectionFilter.status = status.trim();
      }
    }

    // Determine which data types to include
    const includeExpenses = !type || type === 'Expenses' || type === 'expense';
    const includeTransactions = !type || type === 'Transactions' || type === 'transaction';
    const includeCollections = !type || type === 'Collections' || type === 'collection';
    const includeWalletTransactions = !type || type === 'WalletTransactions' || type === 'wallet';

    // Fetch filtered data
    const promises = [];
    
    if (includeExpenses) {
      promises.push(
        Expense.find(expenseFilter)
          .populate('userId', 'name email')
          .populate('createdBy', 'name email')
          .populate('approvedBy', 'name email')
          .sort({ createdAt: -1 })
          .lean()
      );
    } else {
      promises.push(Promise.resolve([]));
    }

    if (includeTransactions) {
      promises.push(
        Transaction.find(transactionFilter)
          .populate('sender', 'name email')
          .populate('receiver', 'name email')
          .populate('initiatedBy', 'name email')
          .populate('approvedBy', 'name email')
          .sort({ createdAt: -1 })
          .lean()
      );
    } else {
      promises.push(Promise.resolve([]));
    }

    if (includeCollections) {
      promises.push(
        Collection.find(collectionFilter)
          .populate('collectedBy', 'name email')
          .populate('assignedReceiver', 'name email')
          .populate('approvedBy', 'name email')
          .sort({ createdAt: -1 })
          .lean()
      );
    } else {
      promises.push(Promise.resolve([]));
    }

    if (includeWalletTransactions) {
      promises.push(
        WalletTransaction.find(walletTransactionFilter)
          .populate('performedBy', 'name email')
          .populate('fromUserId', 'name email')
          .populate('toUserId', 'name email')
          .sort({ createdAt: -1 })
          .lean()
      );
    } else {
      promises.push(Promise.resolve([]));
    }

    // Get wallet balance - use getOrCreateWallet to ensure wallet exists
    promises.push(
      getOrCreateWallet(userId).then(wallet => {
        const walletObj = wallet.toObject ? wallet.toObject() : wallet;
        console.log('   💰 Wallet:', walletObj ? 'Found/Created' : 'NULL');
        if (walletObj) {
          console.log('      - Cash Balance:', walletObj.cashBalance || 0);
          console.log('      - UPI Balance:', walletObj.upiBalance || 0);
          console.log('      - Bank Balance:', walletObj.bankBalance || 0);
          console.log('      - Total Balance:', (walletObj.totalBalance || (walletObj.cashBalance || 0) + (walletObj.upiBalance || 0) + (walletObj.bankBalance || 0)));
        }
        return walletObj;
      })
    );

    const [expenses, transactions, collections, walletTransactions, wallet] = await Promise.all(promises);

    // ============================================================================
    // CRITICAL: For Self Wallet Summary Totals, calculate from ALL data (no filters)
    // ============================================================================
    // Filters should ONLY affect the DATA array returned to frontend
    // Summary totals (cashIn/cashOut) should ALWAYS be TOTAL values from ALL data
    // This ensures correct values regardless of filters applied
    // ============================================================================
    let totalCashIn = 0;
    let totalCashOut = 0;
    
    // Calculate TOTAL values from ALL data (ignore filters for summary totals)
    // This ensures summary always shows correct TOTAL values
    // Always calculate TOTAL values (even if wallet doesn't exist)
    // Fetch ALL data without filters to calculate TOTAL values
    // CRITICAL: Only fetch data for the logged-in user (userIdObjectId) to ensure Self Wallet shows only user's own data
    console.log('🔍 [SELF WALLET] Fetching data for userId:', userIdObjectId.toString());
    const [allExpenses, allTransactions, allCollections, allWalletTransactions] = await Promise.all([
      Expense.find({ userId: userIdObjectId }).lean(),
      Transaction.find({
        $or: [
          { sender: userIdObjectId },
          { receiver: userIdObjectId }
        ]
      }).lean(),
      Collection.find({
        $or: [
          { collectedBy: userIdObjectId },
          { assignedReceiver: userIdObjectId }
        ]
      }).lean(),
      WalletTransaction.find({ userId: userIdObjectId, status: 'completed' }).lean()
    ]);
    console.log('🔍 [SELF WALLET] Data fetched - Expenses:', allExpenses.length, ', Transactions:', allTransactions.length, ', Collections:', allCollections.length, ', WalletTransactions:', allWalletTransactions.length);
    
    // Calculate TOTAL cashIn from ALL data (always calculate, even if arrays are empty)
      // 1. Wallet Transactions - Add operations
      allWalletTransactions.forEach(wt => {
        const isTransactionRelated = wt.type === 'transaction';
        if (!isTransactionRelated && (wt.type === 'add' || wt.operation === 'add')) {
          totalCashIn += toSafeNumber(wt.amount);
        }
      });
      
      // 2. Transactions - Where user is receiver (Approved/Completed only)
      allTransactions.forEach(t => {
        const isReceiver = t.receiver && (
          (typeof t.receiver === 'object' && t.receiver._id && t.receiver._id.toString() === userId.toString()) ||
          (typeof t.receiver === 'string' && t.receiver === userId.toString()) ||
          (t.receiver.toString() === userId.toString())
        );
        if (isReceiver && (t.status === 'Approved' || t.status === 'Completed')) {
          totalCashIn += toSafeNumber(t.amount);
        }
      });
      
      // 3. Collections - Where user is collector (Approved/Verified only)
      allCollections.forEach(c => {
        const isCollector = c.collectedBy && (
          (typeof c.collectedBy === 'object' && c.collectedBy._id && c.collectedBy._id.toString() === userId.toString()) ||
          (typeof c.collectedBy === 'string' && c.collectedBy === userId.toString()) ||
          (c.collectedBy.toString() === userId.toString())
        );
        if (isCollector && (c.status === 'Approved' || c.status === 'Verified')) {
          totalCashIn += toSafeNumber(c.amount);
        }
      });
      
      // 4. Expenses - Where user is expense owner (Approved/Completed only) - Cash In (reimbursement)
      allExpenses.forEach(expense => {
        const expenseUserId = expense.userId ? (
          typeof expense.userId === 'object' && expense.userId._id 
            ? expense.userId._id.toString() 
            : expense.userId.toString()
        ) : null;
        const isExpenseOwner = expenseUserId && expenseUserId === userId.toString();
        const isApproved = expense.status === 'Approved' || expense.status === 'Completed';
        if (isExpenseOwner && isApproved) {
          totalCashIn += toSafeNumber(expense.amount);
        }
      });
      
      // Calculate TOTAL cashOut from ALL data
      const expensesWithWalletTransactions = new Set();
      const transactionsWithWalletTransactions = new Set();
      
      // 1. Wallet Transactions - Subtract operations
      allWalletTransactions.forEach(wt => {
        let wtUserId = null;
        if (wt.userId) {
          if (typeof wt.userId === 'object' && wt.userId._id) {
            wtUserId = wt.userId._id.toString();
          } else if (typeof wt.userId === 'string') {
            wtUserId = wt.userId;
          } else {
            wtUserId = wt.userId.toString();
          }
        }
        if (wtUserId && wtUserId === userId.toString() && wt.operation === 'subtract') {
          totalCashOut += toSafeNumber(wt.amount);
          if (wt.type === 'expense' && wt.relatedId) {
            expensesWithWalletTransactions.add(wt.relatedId.toString());
          }
          if (wt.type === 'transaction' && wt.relatedId) {
            transactionsWithWalletTransactions.add(wt.relatedId.toString());
          }
        }
      });
      
      // 2. Transactions - Where user is sender (Approved/Completed only, no wallet transaction)
      allTransactions.forEach(t => {
        const transactionId = t._id ? t._id.toString() : null;
        const hasWalletTransaction = transactionId && transactionsWithWalletTransactions.has(transactionId);
        const isSender = t.sender && (
          (typeof t.sender === 'object' && t.sender._id && t.sender._id.toString() === userId.toString()) ||
          (typeof t.sender === 'string' && t.sender === userId.toString()) ||
          (t.sender.toString() === userId.toString())
        );
        const isReceiver = t.receiver && (
          (typeof t.receiver === 'object' && t.receiver._id && t.receiver._id.toString() === userId.toString()) ||
          (typeof t.receiver === 'string' && t.receiver === userId.toString()) ||
          (t.receiver.toString() === userId.toString())
        );
        if (isSender && !isReceiver && (t.status === 'Approved' || t.status === 'Completed') && !hasWalletTransaction) {
          totalCashOut += toSafeNumber(t.amount);
        }
      });
      
      // 3. Expenses - Where user is approver (Approved/Completed only, no wallet transaction)
      allExpenses.forEach(expense => {
        const expenseId = expense._id ? expense._id.toString() : null;
        const hasWalletTransaction = expenseId && expensesWithWalletTransactions.has(expenseId);
        if (hasWalletTransaction) return;
        
        const approverId = expense.approvedBy ? (
          typeof expense.approvedBy === 'object' && expense.approvedBy._id 
            ? expense.approvedBy._id.toString() 
            : expense.approvedBy.toString()
        ) : null;
        const isApprover = approverId && approverId === userId.toString();
        const isApproved = expense.status === 'Approved' || expense.status === 'Completed';
        if (isApprover && isApproved) {
          totalCashOut += toSafeNumber(expense.amount);
        }
      });
      
    console.log('💼 [SELF WALLET] Calculated TOTAL values from ALL data (no filters):');
    console.log('   User ID:', userId.toString());
    console.log('   Total Cash In:', totalCashIn);
    console.log('   Total Cash Out:', totalCashOut);
    console.log('   (This ensures summary totals are correct regardless of filters applied)');
    console.log('   ⚠️  IMPORTANT: These values should ONLY include data for the logged-in user');

    // Initialize breakdown structure
    const breakdown = {
      Expenses: {
        Approved: { count: 0, amount: 0 },
        Unapproved: { count: 0, amount: 0 },
        Flagged: { count: 0, amount: 0 },
        Rejected: { count: 0, amount: 0 }
      },
      Transactions: {
        Approved: { count: 0, amount: 0 },
        Unapproved: { count: 0, amount: 0 },
        Flagged: { count: 0, amount: 0 },
        Rejected: { count: 0, amount: 0 }
      },
      Collections: {
        Accounted: { count: 0, amount: 0 },
        Unaccounted: { count: 0, amount: 0 },
        Flagged: { count: 0, amount: 0 },
        Rejected: { count: 0, amount: 0 }
      },
      WalletTransactions: {
        Add: { count: 0, amount: 0 },
        Withdraw: { count: 0, amount: 0 }
      }
    };

    // Calculate Cash In
    let cashIn = 0;

    // ============================================================================
    // ACCOUNT-SPECIFIC CASH IN CALCULATION
    // ============================================================================
    // When filtering by accountId (specific account like "Cash" or "Company UPI"):
    // - Cash In = Collections (matching paymentModeId) + Wallet Transactions Add (matching accountId)
    // - Transactions are EXCLUDED (no paymentModeId field, can't distinguish accounts)
    // ============================================================================

    // 1. Wallet Transactions - Add operations
    // IMPORTANT: Exclude WalletTransactions with type='transaction' because those are
    // already counted in the Transactions section (when not filtering by accountId).
    // Only count direct wallet operations (type='add' for Add Amount).
    walletTransactions.forEach(wt => {
      // Only count WalletTransactions that are NOT related to Transactions
      // (Transactions are counted separately in section 2 below, but only when NOT filtering by accountId)
      const isTransactionRelated = wt.type === 'transaction';
      
      if (!isTransactionRelated && (wt.type === 'add' || wt.operation === 'add') && wt.status === 'completed') {
        const amount = toSafeNumber(wt.amount);
        cashIn += amount;
        breakdown.WalletTransactions.Add.count++;
        breakdown.WalletTransactions.Add.amount += amount;
      }
    });

    // 2. Transactions - Where user is receiver
    // IMPORTANT TRANSACTION LOGIC FOR ALL USERS:
    // - Only 'Approved' or 'Completed' transactions affect Cash In/Cash Out
    // - 'Pending', 'Flagged', 'Rejected', 'Cancelled' transactions are NOT counted
    // - When user is RECEIVER: Transaction amount = Cash In
    // - When user is SENDER: Transaction amount = Cash Out (handled in step below)
    // - If transaction is rejected/cancelled after approval, wallet is reversed (handled in transactionController)
    // - This logic applies consistently to ALL users in the system
    // IMPORTANT: When filtering by accountId, Transactions are EXCLUDED from Cash In calculation
    // because Transactions don't have paymentModeId field and can't be linked to specific accounts
    if (!isFilteringBySpecificAccount) {
      transactions.forEach(t => {
        const isReceiver = t.receiver && (
          (typeof t.receiver === 'object' && t.receiver._id && t.receiver._id.toString() === userId.toString()) ||
          (typeof t.receiver === 'string' && t.receiver === userId.toString()) ||
          (t.receiver.toString() === userId.toString())
        );
        
        // Only count 'Approved' or 'Completed' transactions
        if (isReceiver && (t.status === 'Approved' || t.status === 'Completed')) {
          const amount = toSafeNumber(t.amount);
          cashIn += amount;
          
          // Update breakdown
          const normalizedStatus = normalizeStatusKey(t.status || '');
          if (normalizedStatus === 'approved') {
            breakdown.Transactions.Approved.count++;
            breakdown.Transactions.Approved.amount += amount;
          } else if (normalizedStatus === 'flagged') {
            breakdown.Transactions.Flagged.count++;
            breakdown.Transactions.Flagged.amount += amount;
          } else if (normalizedStatus === 'rejected') {
            breakdown.Transactions.Rejected.count++;
            breakdown.Transactions.Rejected.amount += amount;
          } else {
            breakdown.Transactions.Unapproved.count++;
            breakdown.Transactions.Unapproved.amount += amount;
          }
        }
      });
    }

    // 3. Collections - Only where user is collector (NOT assigned receiver)
    // IMPORTANT: Only the collector gets cashIn from collections.
    // The assigned receiver gets cashIn from the autoPay transaction (already counted in transactions section above).
    // Counting collections for assigned receiver would cause double counting.
    collections.forEach(c => {
      const isCollector = c.collectedBy && (
        (typeof c.collectedBy === 'object' && c.collectedBy._id && c.collectedBy._id.toString() === userId.toString()) ||
        (typeof c.collectedBy === 'string' && c.collectedBy === userId.toString()) ||
        (c.collectedBy.toString() === userId.toString())
      );

      // Only count collections where user is the collector
      // Do NOT count if user is only the assigned receiver (they get cashIn from transaction, not collection)
      if (isCollector && (c.status === 'Approved' || c.status === 'Verified')) {
        const amount = toSafeNumber(c.amount);
        cashIn += amount;
        
        // Update breakdown
        const normalizedStatus = normalizeStatusKey(c.status || '');
        if (normalizedStatus === 'accounted' || normalizedStatus === 'approved') {
          breakdown.Collections.Accounted.count++;
          breakdown.Collections.Accounted.amount += amount;
        } else if (normalizedStatus === 'flagged') {
          breakdown.Collections.Flagged.count++;
          breakdown.Collections.Flagged.amount += amount;
        } else if (normalizedStatus === 'rejected') {
          breakdown.Collections.Rejected.count++;
          breakdown.Collections.Rejected.amount += amount;
        } else {
          breakdown.Collections.Unaccounted.count++;
          breakdown.Collections.Unaccounted.amount += amount;
        }
      }
    });

    // Calculate Cash Out - ONLY for logged-in user
    let cashOut = 0;
    let cashOutFromWalletTransactions = 0;
    let cashOutFromTransactions = 0;
    let cashOutFromExpenses = 0;

    // ============================================================================
    // ACCOUNT-SPECIFIC CASH OUT CALCULATION
    // ============================================================================
    // When filtering by accountId (specific account like "Cash" or "Company UPI"):
    // - Cash Out = Wallet Transactions Withdraw/Subtract (matching accountId)
    // - Expenses are EXCLUDED (no paymentModeId field, can't distinguish accounts)
    // - Transactions are EXCLUDED (no paymentModeId field, can't distinguish accounts)
    // ============================================================================

    // Track which expenses already have corresponding wallet transactions to avoid double counting
    const accountExpensesWithWalletTransactions = new Set();
    // Track which transactions already have corresponding wallet transactions to avoid double counting
    const accountTransactionsWithWalletTransactions = new Set();
    
    // 1. Wallet Transactions - All subtract operations (withdraw, expense, transaction_out, etc.)
    // Only count wallet transactions belonging to the logged-in user
    walletTransactions.forEach(wt => {
      // Double-check that wallet transaction belongs to logged-in user
      let wtUserId = null;
      if (wt.userId) {
        if (typeof wt.userId === 'object' && wt.userId._id) {
          wtUserId = wt.userId._id.toString();
        } else if (typeof wt.userId === 'string') {
          wtUserId = wt.userId;
        } else {
          wtUserId = wt.userId.toString();
        }
      }
      
      if (wtUserId && wtUserId === userId.toString() && wt.operation === 'subtract' && wt.status === 'completed') {
        const amount = toSafeNumber(wt.amount);
        cashOut += amount;
        cashOutFromWalletTransactions += amount;
        
        // Track wallet transactions related to expenses to avoid double counting
        if (wt.type === 'expense' && wt.relatedId) {
          accountExpensesWithWalletTransactions.add(wt.relatedId.toString());
        }
        
        // Track wallet transactions related to transactions to avoid double counting
        // When a Transaction is processed, it creates a WalletTransaction with type='transaction'
        // So we should NOT count the Transaction document separately if it has a wallet transaction
        if (wt.type === 'transaction' && wt.relatedId) {
          const relatedIdStr = wt.relatedId.toString();
          accountTransactionsWithWalletTransactions.add(relatedIdStr);
          console.log(`   🔗 WalletTransaction (ID: ${wt._id}) linked to Transaction (ID: ${relatedIdStr}) - will skip Transaction in cash out calculation`);
        }
        
        // Update breakdown for wallet transactions (withdraw operations)
        if (wt.type === 'withdraw') {
          breakdown.WalletTransactions.Withdraw.count++;
          breakdown.WalletTransactions.Withdraw.amount += amount;
        }
        // Note: Wallet transactions with type='expense' represent expenses that have already been
        // processed and created wallet entries, so we count them here to avoid double counting
        // with the expenses section below
      }
    });

    // 2. Transactions - ONLY where logged-in user is sender (money going out)
    // IMPORTANT TRANSACTION LOGIC FOR ALL USERS:
    // - Only 'Approved' or 'Completed' transactions affect Cash In/Cash Out
    // - 'Pending', 'Flagged', 'Rejected', 'Cancelled' transactions are NOT counted
    // - When user is RECEIVER: Transaction amount = Cash In (handled in step above)
    // - When user is SENDER: Transaction amount = Cash Out
    // - If transaction is rejected/cancelled after approval, wallet is reversed (handled in transactionController)
    // - This logic applies consistently to ALL users in the system
    // Do NOT count transactions where user is receiver (those are cash in)
    // IMPORTANT: When filtering by accountId, Transactions are EXCLUDED from Cash Out calculation
    // because Transactions don't have paymentModeId field and can't be linked to specific accounts
    if (!isFilteringBySpecificAccount) {
      transactions.forEach(t => {
        const transactionId = t._id ? t._id.toString() : null;
        const hasWalletTransaction = transactionId && accountTransactionsWithWalletTransactions.has(transactionId);
        
        // Verify user is the sender (not receiver)
        const isSender = t.sender && (
          (typeof t.sender === 'object' && t.sender._id && t.sender._id.toString() === userId.toString()) ||
          (typeof t.sender === 'string' && t.sender === userId.toString()) ||
          (t.sender.toString() === userId.toString())
        );
        
        // IMPORTANT: Only count as cash out if user is sender (money going out)
        // Do NOT count if user is receiver (that's cash in, already handled above)
        const isReceiver = t.receiver && (
          (typeof t.receiver === 'object' && t.receiver._id && t.receiver._id.toString() === userId.toString()) ||
          (typeof t.receiver === 'string' && t.receiver === userId.toString()) ||
          (t.receiver.toString() === userId.toString())
        );
        
        // Only process transactions where user is sender (NOT receiver)
        // Only count 'Approved' or 'Completed' transactions
        if (isSender && !isReceiver && (t.status === 'Approved' || t.status === 'Completed')) {
          const amount = toSafeNumber(t.amount);
          
          // IMPORTANT: Only count in cash out if transaction doesn't have a wallet transaction
          // (if it has a wallet transaction, it's already been counted in step 1 above)
          if (!hasWalletTransaction) {
            cashOut += amount;
            cashOutFromTransactions += amount;
          } else {
            console.log(`   ⏭️  Skipping Transaction (ID: ${transactionId}) - already counted as WalletTransaction (amount: ₹${amount})`);
          }
          
          // Update breakdown for ALL transactions (for display purposes, regardless of wallet transaction)
          const normalizedStatus = normalizeStatusKey(t.status || '');
          if (normalizedStatus === 'approved') {
            breakdown.Transactions.Approved.count++;
            breakdown.Transactions.Approved.amount += amount;
          } else if (normalizedStatus === 'flagged') {
            breakdown.Transactions.Flagged.count++;
            breakdown.Transactions.Flagged.amount += amount;
          } else if (normalizedStatus === 'rejected') {
            breakdown.Transactions.Rejected.count++;
            breakdown.Transactions.Rejected.amount += amount;
          } else {
            breakdown.Transactions.Unapproved.count++;
            breakdown.Transactions.Unapproved.amount += amount;
          }
        }
      });
    }

    // 3. Expenses - Calculate based on user's role (expense owner OR approver)
    // IMPORTANT: When filtering by accountId, Expenses are EXCLUDED from Cash In/Out calculation
    // because Expenses don't have paymentModeId field and can't be linked to specific accounts
    // 
    // Expense Logic:
    // - If user is expense owner (userId): Approved expense = Cash In (reimbursement received)
    // - If user is approver (approvedBy): Approved expense = Cash Out (payment made)
    // Only count expenses that DON'T have corresponding wallet transactions
    // This avoids double counting: if an expense created a wallet transaction (type='expense'),
    // we've already counted it in step 1 above
    if (!isFilteringBySpecificAccount) {
      expenses.forEach(expense => {
        const expenseId = expense._id ? expense._id.toString() : null;
        const hasWalletTransaction = expenseId && accountExpensesWithWalletTransactions.has(expenseId);
        
        // Skip if already counted as wallet transaction
        if (hasWalletTransaction) {
          // Still update breakdown for display purposes
          const amount = toSafeNumber(expense.amount);
          const normalizedStatus = normalizeStatusKey(expense.status || '');
          if (normalizedStatus === 'approved') {
            breakdown.Expenses.Approved.count++;
            breakdown.Expenses.Approved.amount += amount;
          } else if (normalizedStatus === 'flagged') {
            breakdown.Expenses.Flagged.count++;
            breakdown.Expenses.Flagged.amount += amount;
          } else if (normalizedStatus === 'rejected') {
            breakdown.Expenses.Rejected.count++;
            breakdown.Expenses.Rejected.amount += amount;
          } else {
            breakdown.Expenses.Unapproved.count++;
            breakdown.Expenses.Unapproved.amount += amount;
          }
          return;
        }
        
        // Get expense owner ID
        let expenseUserId = null;
        if (expense.userId) {
          if (typeof expense.userId === 'object' && expense.userId._id) {
            expenseUserId = expense.userId._id.toString();
          } else if (typeof expense.userId === 'string') {
            expenseUserId = expense.userId;
          } else {
            expenseUserId = expense.userId.toString();
          }
        }
        
        // Get approver ID
        let approverId = null;
        if (expense.approvedBy) {
          if (typeof expense.approvedBy === 'object' && expense.approvedBy._id) {
            approverId = expense.approvedBy._id.toString();
          } else if (typeof expense.approvedBy === 'string') {
            approverId = expense.approvedBy;
          } else {
            approverId = expense.approvedBy.toString();
          }
        }
        
        const amount = toSafeNumber(expense.amount);
        const normalizedStatus = normalizeStatusKey(expense.status || '');
        const isApproved = normalizedStatus === 'approved';
        
        // Check if logged-in user is expense owner
        const isExpenseOwner = expenseUserId && expenseUserId === userId.toString();
        // Check if logged-in user is approver
        const isApprover = approverId && approverId === userId.toString();
        
        // Calculate Cash In/Out based on user's role
        if (isApproved) {
          if (isExpenseOwner) {
            // User is expense owner: Approved expense = Cash In (reimbursement received)
            cashIn += amount;
            breakdown.Expenses.Approved.count++;
            breakdown.Expenses.Approved.amount += amount;
          } else if (isApprover) {
            // User is approver: Approved expense = Cash Out (payment made)
            cashOut += amount;
            cashOutFromExpenses += amount;
            breakdown.Expenses.Approved.count++;
            breakdown.Expenses.Approved.amount += amount;
          }
        } else {
          // Update breakdown for non-approved expenses (for display purposes)
          if (normalizedStatus === 'flagged') {
            breakdown.Expenses.Flagged.count++;
            breakdown.Expenses.Flagged.amount += amount;
          } else if (normalizedStatus === 'rejected') {
            breakdown.Expenses.Rejected.count++;
            breakdown.Expenses.Rejected.amount += amount;
          } else {
            breakdown.Expenses.Unapproved.count++;
            breakdown.Expenses.Unapproved.amount += amount;
          }
        }
      });
    }

    // Get current wallet balance
    const walletBalance = wallet ? (wallet.totalBalance || ((wallet.cashBalance || 0) + (wallet.upiBalance || 0) + (wallet.bankBalance || 0))) : 0;

    // Combine all data into single array
    const allData = [];
    
    expenses.forEach(e => {
      allData.push({
        ...e,
        dataType: 'Expense',
        type: 'Expenses' // Add type field for frontend filtering (plural form)
      });
    });
    
    transactions.forEach(t => {
      allData.push({
        ...t,
        dataType: 'Transaction',
        type: 'Transactions' // Add type field for frontend filtering (plural form)
      });
    });
    
    collections.forEach(c => {
      allData.push({
        ...c,
        dataType: 'Collection',
        type: 'Collections' // Add type field for frontend filtering (plural form)
      });
    });
    
    walletTransactions.forEach(wt => {
      allData.push({
        ...wt,
        dataType: 'WalletTransaction',
        type: 'WalletTransactions' // Add type field for frontend filtering (plural form)
      });
    });

    // Sort by date (newest first)
    allData.sort((a, b) => {
      const dateA = new Date(a.createdAt || a.date || 0);
      const dateB = new Date(b.createdAt || b.date || 0);
      return dateB - dateA;
    });

    // CRITICAL: For Self Wallet, use calculated TOTAL values from ALL data (no filters)
    // Filters (date/status/type) should ONLY affect the DATA array, NOT the summary totals
    // This ensures that Cash In/Cash Out/Balance always show correct TOTAL values regardless of filters
    // We calculate from ALL data to get accurate TOTAL values, not from filtered data or stored wallet values
    // ALWAYS use calculated TOTAL values (even if they are 0) to ensure consistency on every refresh
    let finalCashIn = totalCashIn;
    let finalCashOut = totalCashOut;
    
    console.log('💼 [SELF WALLET] Using calculated TOTAL values from ALL data:', finalCashIn, '/', finalCashOut);
    console.log('   (Stored wallet values were: cashIn=', wallet?.cashIn || 0, ', cashOut=', wallet?.cashOut || 0, ')');
    console.log('   (Calculated from FILTERED data were: cashIn=', cashIn, ', cashOut=', cashOut, ')');
    console.log('   Note: TOTAL values are from ALL data (no filters), ensuring correct summary totals on every refresh');

    console.log('   Results:');
    console.log('     - Expenses:', expenses.length);
    console.log('     - Transactions:', transactions.length);
    console.log('     - Collections:', collections.length);
    console.log('     - Wallet Transactions:', walletTransactions.length);
    console.log('     - Cash In (calculated):', cashIn);
    console.log('     - Cash Out (calculated):', cashOut);
    console.log('     - Cash In (final, from wallet):', finalCashIn);
    console.log('     - Cash Out (final, from wallet):', finalCashOut);
    console.log('       📤 Cash Out Breakdown (ONLY logged-in user):');
    console.log('         - From Wallet Transactions:', cashOutFromWalletTransactions);
    console.log('         - From Transactions (as sender, no wallet transaction):', cashOutFromTransactions);
    console.log('         - From Expenses:', cashOutFromExpenses);
    console.log('         - Total Cash Out (calculated):', cashOut);
    console.log(`     - Transactions tracked with wallet transactions: ${accountTransactionsWithWalletTransactions.size}`);
    console.log(`     - Expenses tracked with wallet transactions: ${accountExpensesWithWalletTransactions.size}`);
    console.log('     - Balance:', walletBalance);
    console.log('=====================================\n');

    res.status(200).json({
      success: true,
      data: allData,
      wallet: wallet ? {
        cashBalance: toSafeNumber(wallet.cashBalance),
        upiBalance: toSafeNumber(wallet.upiBalance),
        bankBalance: toSafeNumber(wallet.bankBalance),
        totalBalance: walletBalance
      } : {
        cashBalance: 0,
        upiBalance: 0,
        bankBalance: 0,
        totalBalance: 0
      },
      summary: {
        cashIn: toSafeNumber(finalCashIn),
        cashOut: toSafeNumber(finalCashOut),
        balance: walletBalance
      },
      breakdown: breakdown,
      count: allData.length,
      filterMode: 'user', // CRITICAL: Explicitly set filterMode for Self Wallet to ensure frontend uses correct parsing logic
      walletSummary: null, // CRITICAL: Explicitly set to null for Self Wallet to prevent frontend from using aggregated values
      message: 'Self wallet report retrieved successfully'
    });
  } catch (error) {
    console.error('Error in getSelfWalletReport:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get specific wallet transaction by ID
// @route   GET /api/wallet/transactions/:id
// @access  Private
exports.getWalletTransactionById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid transaction ID'
      });
    }

    const transaction = await WalletTransaction.findById(id)
      .populate('performedBy', 'name email role')
      .populate('fromUserId', 'name email')
      .populate('toUserId', 'name email')
      .populate('userId', 'name email role');

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    // Check if user has access to this transaction
    if (transaction.userId.toString() !== req.user._id.toString() && req.user.role !== 'SuperAdmin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.status(200).json({
      success: true,
      transaction: {
        id: transaction._id,
        userId: transaction.userId,
        walletId: transaction.walletId,
        type: transaction.type,
        mode: transaction.mode,
        amount: transaction.amount,
        operation: transaction.operation,
        fromMode: transaction.fromMode,
        toMode: transaction.toMode,
        fromUserId: transaction.fromUserId,
        toUserId: transaction.toUserId,
        relatedId: transaction.relatedId,
        relatedModel: transaction.relatedModel,
        balanceAfter: transaction.balanceAfter,
        notes: transaction.notes,
        performedBy: transaction.performedBy ? {
          id: transaction.performedBy._id,
          name: transaction.performedBy.name,
          email: transaction.performedBy.email,
          role: transaction.performedBy.role
        } : null,
        status: transaction.status,
        createdAt: transaction.createdAt,
        updatedAt: transaction.updatedAt
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Add amount to account
// @route   POST /api/accounts/add-amount
// @access  Private (All users - SuperAdmin can add to any account, others to their own)
exports.addAmountToAccount = async (req, res) => {
  try {
    const { accountId, amount, remark } = req.body;

    if (!accountId || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Please provide accountId and amount'
      });
    }

    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be greater than 0'
      });
    }

    // For regular users, they can only add to their own wallet
    // SuperAdmin can add to any user's wallet via userId parameter
    let targetUserId = req.user._id; // Default to current user
    
    // Only SuperAdmin can specify a different userId
    if (req.body.userId && req.user.role === 'SuperAdmin') {
      targetUserId = req.body.userId;
    } else if (req.body.userId && req.user.role !== 'SuperAdmin') {
      return res.status(403).json({
        success: false,
        message: 'You can only add amounts to your own wallet'
      });
    }

    // Fetch payment mode to get the correct mode (Cash, UPI, or Bank)
    const PaymentMode = require('../models/paymentModeModel');
    let mode = 'Bank'; // Default to Bank
    
    try {
      const paymentMode = await PaymentMode.findById(accountId);
      if (paymentMode) {
        // Try to extract mode from description or infer from modeName
        const modeName = (paymentMode.modeName || '').toLowerCase();
        if (modeName.includes('cash')) {
          mode = 'Cash';
        } else if (modeName.includes('upi')) {
          mode = 'UPI';
        } else if (modeName.includes('bank')) {
          mode = 'Bank';
        }
        // If description contains mode info, use that
        if (paymentMode.description) {
          const desc = paymentMode.description.toLowerCase();
          if (desc.includes('cash')) mode = 'Cash';
          else if (desc.includes('upi')) mode = 'UPI';
          else if (desc.includes('bank')) mode = 'Bank';
        }
      }
    } catch (error) {
      console.log('Error fetching payment mode, using default Bank mode:', error.message);
      // Continue with default Bank mode
    }
    const wallet = await updateWalletBalance(targetUserId, mode, amount, 'add', 'add');
    
    // Get user info for notification
    const targetUser = await User.findById(targetUserId);

    // Create wallet transaction entry
    const walletTransaction = await createWalletTransaction(
      wallet,
      'add',
      mode,
      amount,
      'add',
      req.user._id,
      { 
        notes: remark || (req.user.role === 'SuperAdmin' 
          ? `Amount added to account ${accountId} by SuperAdmin`
          : `Amount added to account ${accountId} by ${req.user.name || 'User'}`),
        accountId: accountId
      }
    );

    await createAuditLog(
      req.user._id,
      `Added ${amount} to account ${accountId}`,
      'Update',
      'Wallet',
      wallet._id,
      { [mode.toLowerCase()]: wallet[mode.toLowerCase()] - amount },
      { [mode.toLowerCase()]: wallet[mode.toLowerCase()] },
      req.ip,
      remark || (req.user.role === 'SuperAdmin' 
        ? `Amount added to account ${accountId} by SuperAdmin`
        : `Amount added to account ${accountId} by ${req.user.name || 'User'}`)
    );

    // Emit real-time update
    await notifyAmountUpdate('account_add', {
      userId: targetUserId,
      userName: targetUser?.name || 'Unknown',
      accountId: accountId,
      mode,
      amount,
      operation: 'add',
      wallet: {
        cashBalance: wallet.cashBalance,
        upiBalance: wallet.upiBalance,
        bankBalance: wallet.bankBalance,
        totalBalance: wallet.totalBalance
      },
      notes: remark || (req.user.role === 'SuperAdmin' 
        ? `Amount added to account ${accountId} by SuperAdmin`
        : `Amount added to account ${accountId} by ${req.user.name || 'User'}`),
      performedBy: req.user._id,
      transactionId: walletTransaction?._id
    });

    // Emit self wallet update to the target user
    const { emitSelfWalletUpdate } = require('../utils/socketService');
    emitSelfWalletUpdate(targetUserId.toString(), {
      type: 'account_add',
      wallet: {
        cashBalance: wallet.cashBalance,
        upiBalance: wallet.upiBalance,
        bankBalance: wallet.bankBalance,
        totalBalance: wallet.totalBalance
      },
      transaction: walletTransaction ? {
        id: walletTransaction._id,
        type: walletTransaction.type,
        mode: walletTransaction.mode,
        amount: walletTransaction.amount,
        operation: walletTransaction.operation,
        createdAt: walletTransaction.createdAt
      } : null
    });

    res.status(200).json({
      success: true,
      message: 'Amount added to account successfully',
      wallet,
      transaction: walletTransaction
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Withdraw amount from account
// @route   POST /api/accounts/withdraw
// @access  Private (All users - SuperAdmin can withdraw from any account, others from their own)
exports.withdrawFromAccount = async (req, res) => {
  try {
    const { accountId, amount, remark } = req.body;

    if (!accountId || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Please provide accountId and amount'
      });
    }

    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be greater than 0'
      });
    }

    // For regular users, they can only withdraw from their own wallet
    // SuperAdmin can withdraw from any user's wallet via userId parameter
    let targetUserId = req.user._id; // Default to current user
    
    // Only SuperAdmin can specify a different userId
    if (req.body.userId && req.user.role === 'SuperAdmin') {
      targetUserId = req.body.userId;
    } else if (req.body.userId && req.user.role !== 'SuperAdmin') {
      return res.status(403).json({
        success: false,
        message: 'You can only withdraw amounts from your own wallet'
      });
    }

    // Fetch payment mode to get the correct mode (Cash, UPI, or Bank)
    const PaymentMode = require('../models/paymentModeModel');
    let mode = 'Bank'; // Default to Bank
    
    try {
      const paymentMode = await PaymentMode.findById(accountId);
      if (paymentMode) {
        // Try to extract mode from description or infer from modeName
        const modeName = (paymentMode.modeName || '').toLowerCase();
        if (modeName.includes('cash')) {
          mode = 'Cash';
        } else if (modeName.includes('upi')) {
          mode = 'UPI';
        } else if (modeName.includes('bank')) {
          mode = 'Bank';
        }
        // If description contains mode info, use that
        if (paymentMode.description) {
          const desc = paymentMode.description.toLowerCase();
          if (desc.includes('cash')) mode = 'Cash';
          else if (desc.includes('upi')) mode = 'UPI';
          else if (desc.includes('bank')) mode = 'Bank';
        }
      }
    } catch (error) {
      console.log('Error fetching payment mode, using default Bank mode:', error.message);
      // Continue with default Bank mode
    }
    const wallet = await updateWalletBalance(targetUserId, mode, amount, 'subtract', 'withdraw');
    
    // Get user info for notification
    const targetUser = await User.findById(targetUserId);

    // Create wallet transaction entry
    const defaultRemark = req.user.role === 'SuperAdmin'
      ? `Amount withdrawn from account ${accountId} by SuperAdmin`
      : `Amount withdrawn from account ${accountId} by ${req.user.name || 'User'}`;
    
    const walletTransaction = await createWalletTransaction(
      wallet,
      'withdraw',
      mode,
      amount,
      'subtract',
      req.user._id,
      { 
        notes: remark || defaultRemark,
        accountId: accountId
      }
    );

    await createAuditLog(
      req.user._id,
      `Withdrew ${amount} from account ${accountId}`,
      'Update',
      'Wallet',
      wallet._id,
      { [mode.toLowerCase()]: wallet[mode.toLowerCase()] + amount },
      { [mode.toLowerCase()]: wallet[mode.toLowerCase()] },
      req.ip,
      remark || defaultRemark
    );

    // Emit real-time update
    await notifyAmountUpdate('account_withdraw', {
      userId: targetUserId,
      userName: targetUser?.name || 'Unknown',
      accountId: accountId,
      mode,
      amount,
      operation: 'subtract',
      wallet: {
        cashBalance: wallet.cashBalance,
        upiBalance: wallet.upiBalance,
        bankBalance: wallet.bankBalance,
        totalBalance: wallet.totalBalance
      },
      notes: remark || defaultRemark,
      performedBy: req.user._id,
      transactionId: walletTransaction?._id
    });

    // Emit self wallet update to the target user
    const { emitSelfWalletUpdate } = require('../utils/socketService');
    emitSelfWalletUpdate(targetUserId.toString(), {
      type: 'account_withdraw',
      wallet: {
        cashBalance: wallet.cashBalance,
        upiBalance: wallet.upiBalance,
        bankBalance: wallet.bankBalance,
        totalBalance: wallet.totalBalance
      },
      transaction: walletTransaction ? {
        id: walletTransaction._id,
        type: walletTransaction.type,
        mode: walletTransaction.mode,
        amount: walletTransaction.amount,
        operation: walletTransaction.operation,
        createdAt: walletTransaction.createdAt
      } : null
    });

    res.status(200).json({
      success: true,
      message: 'Amount withdrawn from account successfully',
      wallet,
      transaction: walletTransaction
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
