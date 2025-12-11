const Wallet = require('../models/walletModel');
const User = require('../models/userModel');
const WalletTransaction = require('../models/walletTransactionModel');
const PaymentMode = require('../models/paymentModeModel');

// Helper function to calculate totals from all wallets
const calculateAllUsersTotals = async () => {
  try {
    console.log('📊 [ALL WALLET REPORTS] Calculating totals from all wallets...');
    
    const allWallets = await Wallet.find({});
    const walletCount = allWallets.length;
    
    console.log(`📊 [ALL WALLET REPORTS] Querying ${walletCount} wallets from database`);
    
    let totalCashIn = 0;
    let totalCashOut = 0;
    let totalBalance = 0;
    
    allWallets.forEach(wallet => {
      totalCashIn += toSafeNumber(wallet.cashIn || 0);
      totalCashOut += toSafeNumber(wallet.cashOut || 0);
      
      // Calculate total balance (cashBalance + upiBalance + bankBalance)
      const cashBalance = toSafeNumber(wallet.cashBalance || 0);
      const upiBalance = toSafeNumber(wallet.upiBalance || 0);
      const bankBalance = toSafeNumber(wallet.bankBalance || 0);
      const walletTotalBalance = cashBalance + upiBalance + bankBalance;
      
      totalBalance += walletTotalBalance;
    });
    
    console.log(`📊 [ALL WALLET REPORTS] Calculated totals: CashIn=${totalCashIn}, CashOut=${totalCashOut}, Balance=${totalBalance}`);
    
    return {
      totalCashIn,
      totalCashOut,
      totalBalance,
      userCount: walletCount
    };
  } catch (error) {
    console.error('❌ [ALL WALLET REPORTS] Error calculating all users totals:', error);
    throw error;
  }
};

// Helper function to calculate totals for a specific user
const calculateUserTotals = async (userId) => {
  try {
    console.log(`📊 [ALL WALLET REPORTS] Calculating totals for userId: ${userId}`);
    
    const wallet = await Wallet.findOne({ userId });
    
    if (!wallet) {
      console.log(`📊 [ALL WALLET REPORTS] Wallet not found for userId: ${userId}`);
      return {
        cashIn: 0,
        cashOut: 0,
        balance: 0
      };
    }
    
    const cashIn = toSafeNumber(wallet.cashIn || 0);
    const cashOut = toSafeNumber(wallet.cashOut || 0);
    
    // Calculate total balance
    const cashBalance = toSafeNumber(wallet.cashBalance || 0);
    const upiBalance = toSafeNumber(wallet.upiBalance || 0);
    const bankBalance = toSafeNumber(wallet.bankBalance || 0);
    const balance = cashBalance + upiBalance + bankBalance;
    
    console.log(`📊 [ALL WALLET REPORTS] User totals: CashIn=${cashIn}, CashOut=${cashOut}, Balance=${balance}`);
    
    return {
      cashIn,
      cashOut,
      balance
    };
  } catch (error) {
    console.error(`❌ [ALL WALLET REPORTS] Error calculating user totals for userId ${userId}:`, error);
    throw error;
  }
};

// Helper function to safely convert values to numbers
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

// Helper function to get payment mode object
const getPaymentModeObject = async (paymentModeId) => {
  if (!paymentModeId) return null;
  
  // If paymentModeId is already populated (object with modeName), return it
  if (typeof paymentModeId === 'object' && paymentModeId.modeName) {
    return {
      _id: paymentModeId._id || paymentModeId,
      id: paymentModeId._id || paymentModeId,
      modeName: paymentModeId.modeName,
      description: paymentModeId.description || null
    };
  }
  
  // If paymentModeId is an ObjectId string or ObjectId, fetch from database
  try {
    const paymentMode = await PaymentMode.findById(paymentModeId).select('modeName description').lean();
    
    if (paymentMode && paymentMode.modeName) {
      return {
        _id: paymentMode._id || paymentModeId,
        id: paymentMode._id || paymentModeId,
        modeName: paymentMode.modeName,
        description: paymentMode.description || null
      };
    }
  } catch (error) {
    console.error(`[getPaymentModeObject] Error fetching PaymentMode ${paymentModeId}:`, error.message);
  }
  
  return null;
};

// @desc    Get aggregated totals for all users
// @route   GET /api/all-wallet-reports/totals
// @access  Private (SuperAdmin only)
exports.getAllWalletReportsTotals = async (req, res) => {
  try {
    console.log('📊 [ALL WALLET REPORTS] GET /api/all-wallet-reports/totals - Request received');
    
    const totals = await calculateAllUsersTotals();
    
    const response = {
      success: true,
      totals: {
        totalCashIn: totals.totalCashIn,
        totalCashOut: totals.totalCashOut,
        totalBalance: totals.totalBalance,
        userCount: totals.userCount,
        lastUpdated: new Date().toISOString()
      }
    };
    
    console.log(`📊 [ALL WALLET REPORTS] Response sent: success=true, totals=${JSON.stringify(response.totals)}`);
    
    res.status(200).json(response);
  } catch (error) {
    console.error('❌ [ALL WALLET REPORTS] Error in getAllWalletReportsTotals:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch wallet reports totals'
    });
  }
};

// @desc    Get wallet report for a specific user
// @route   GET /api/all-wallet-reports/user/:userId
// @access  Private (SuperAdmin only)
exports.getUserWalletReport = async (req, res) => {
  try {
    const { userId } = req.params;
    
    console.log(`📊 [ALL WALLET REPORTS] GET /api/all-wallet-reports/user/:userId - Request received for userId: ${userId}`);
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }
    
    // Validate userId format (MongoDB ObjectId)
    if (!userId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format'
      });
    }
    
    // Get user information
    const user = await User.findById(userId).select('name email role');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Calculate user totals
    const report = await calculateUserTotals(userId);
    
    const response = {
      success: true,
      userId: userId,
      userName: user.name || 'Unknown',
      report: {
        cashIn: report.cashIn,
        cashOut: report.cashOut,
        balance: report.balance
      },
      lastUpdated: new Date().toISOString()
    };
    
    console.log(`📊 [ALL WALLET REPORTS] Response sent: success=true, userId=${userId}, report=${JSON.stringify(response.report)}`);
    
    res.status(200).json(response);
  } catch (error) {
    console.error(`❌ [ALL WALLET REPORTS] Error in getUserWalletReport:`, error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch user wallet report'
    });
  }
};

// @desc    Get all wallet reports with optional filters
// @route   GET /api/all-wallet-reports
// @access  Private (SuperAdmin only)
exports.getAllWalletReportsWithFilters = async (req, res) => {
  try {
    const { userId, startDate, endDate, accountId } = req.query;
    
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📊 [ALL WALLET REPORTS] GET /api/all-wallet-reports - Request received');
    console.log('   Timestamp:', new Date().toISOString());
    console.log('   Query Parameters:');
    console.log('     - userId:', userId || 'null');
    console.log('     - startDate:', startDate || 'null');
    console.log('     - endDate:', endDate || 'null');
    console.log('     - accountId:', accountId || 'null');
    console.log('   Full Query:', JSON.stringify(req.query, null, 2));
    console.log('═══════════════════════════════════════════════════════════');
    
    // Handle accountId filtering (accountId is the paymentModeId for Add Amount/Withdraw transactions)
    if (accountId) {
      console.log('📊 [ALL WALLET REPORTS] accountId filter provided:', accountId);
    }
    
    let report;
    let userCount = 0;
    
    if (userId) {
      // Check if userId contains commas (multiple users)
      const userIds = userId.includes(',') 
        ? userId.split(',').map(id => id.trim()).filter(id => id)
        : [userId];
      
      if (userIds.length === 1) {
        // Single user
        console.log('📊 [ALL WALLET REPORTS] Processing single user report...');
        const singleUserId = userIds[0];
        
        // Validate user ID format
        if (!singleUserId.match(/^[0-9a-fA-F]{24}$/)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid user ID format'
          });
        }
        
        const user = await User.findById(singleUserId).select('name');
        if (!user) {
          return res.status(404).json({
            success: false,
            message: 'User not found'
          });
        }
        
        const userTotals = await calculateUserTotals(singleUserId);
        report = {
          cashIn: userTotals.cashIn,
          cashOut: userTotals.cashOut,
          balance: userTotals.balance
        };
        userCount = 1;
        console.log(`✅ [ALL WALLET REPORTS] Single user report calculated: CashIn=${report.cashIn}, CashOut=${report.cashOut}, Balance=${report.balance}`);
      } else {
        // Multiple users - calculate aggregated totals
        console.log(`📊 [ALL WALLET REPORTS] Processing multiple users report (${userIds.length} users)...`);
        console.log(`   User IDs: ${userIds.join(', ')}`);
        
        // Validate all user IDs
        for (const id of userIds) {
          if (!id.match(/^[0-9a-fA-F]{24}$/)) {
            return res.status(400).json({
              success: false,
              message: `Invalid user ID format: ${id}`
            });
          }
        }
        
        // Verify all users exist
        const users = await User.find({ _id: { $in: userIds } }).select('name _id');
        const foundUserIds = users.map(u => u._id.toString());
        const missingUserIds = userIds.filter(id => !foundUserIds.includes(id));
        
        if (missingUserIds.length > 0) {
          return res.status(404).json({
            success: false,
            message: `User(s) not found: ${missingUserIds.join(', ')}`
          });
        }
        
        // Calculate totals for each user and sum them up
        let totalCashIn = 0;
        let totalCashOut = 0;
        let totalBalance = 0;
        
        for (const id of userIds) {
          const userTotals = await calculateUserTotals(id);
          totalCashIn += userTotals.cashIn;
          totalCashOut += userTotals.cashOut;
          totalBalance += userTotals.balance;
          
          console.log(`   User ${id}: CashIn=${userTotals.cashIn}, CashOut=${userTotals.cashOut}, Balance=${userTotals.balance}`);
        }
        
        report = {
          cashIn: totalCashIn,
          cashOut: totalCashOut,
          balance: totalBalance
        };
        userCount = userIds.length;
        console.log(`✅ [ALL WALLET REPORTS] Multiple users report calculated: CashIn=${report.cashIn}, CashOut=${report.cashOut}, Balance=${report.balance}, userCount=${userCount}`);
      }
    } else {
      console.log('📊 [ALL WALLET REPORTS] Processing all users aggregated report...');
      // Get aggregated totals for all users
      const totals = await calculateAllUsersTotals();
      report = {
        cashIn: totals.totalCashIn,
        cashOut: totals.totalCashOut,
        balance: totals.totalBalance
      };
      userCount = totals.userCount;
      console.log(`✅ [ALL WALLET REPORTS] All users report calculated: CashIn=${report.cashIn}, CashOut=${report.cashOut}, Balance=${report.balance}, userCount=${userCount}`);
    }
    
    // Query WalletTransaction collection for Add Amount and Withdraw transactions
    console.log('📊 [ALL WALLET REPORTS] Querying WalletTransaction collection...');
    
    const walletTransactionFilter = {
      type: { $in: ['add', 'withdraw'] },
      status: 'completed'
    };
    
    // Apply userId filter if provided
    if (userId) {
      const userIds = userId.includes(',') 
        ? userId.split(',').map(id => id.trim()).filter(id => id)
        : [userId];
      
      if (userIds.length === 1) {
        walletTransactionFilter.userId = userIds[0];
      } else {
        walletTransactionFilter.userId = { $in: userIds };
      }
    }
    
    // Apply date range filter if provided
    if (startDate || endDate) {
      walletTransactionFilter.createdAt = {};
      if (startDate) {
        walletTransactionFilter.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        const endDateTime = new Date(endDate);
        endDateTime.setHours(23, 59, 59, 999); // End of day
        walletTransactionFilter.createdAt.$lte = endDateTime;
      }
    }
    
    // Apply accountId filter if provided (accountId is the paymentModeId)
    if (accountId) {
      const mongoose = require('mongoose');
      if (mongoose.Types.ObjectId.isValid(accountId)) {
        walletTransactionFilter.paymentModeId = accountId;
        console.log(`📊 [ALL WALLET REPORTS] Filtering by accountId (paymentModeId): ${accountId}`);
      } else {
        console.log(`⚠️  [ALL WALLET REPORTS] Invalid accountId format: ${accountId}`);
      }
    }
    
    // Query WalletTransactions
    const walletTransactions = await WalletTransaction.find(walletTransactionFilter)
      .populate('userId', 'name email role')
      .populate('performedBy', 'name email role')
      .populate('paymentModeId', 'modeName description')
      .sort({ createdAt: -1 })
      .lean();
    
    console.log(`📊 [ALL WALLET REPORTS] Found ${walletTransactions.length} wallet transactions`);
    
    // Transform WalletTransactions to table format
    const transformedTransactions = await Promise.all(
      walletTransactions.map(async (wt) => {
        // Extract accountId from notes if available
        let extractedAccountId = null;
        let accountName = 'Unknown Account';
        
        if (wt.notes) {
          const accountMatch = wt.notes.match(/account\s+([^\s]+)/i);
          if (accountMatch) {
            extractedAccountId = accountMatch[1];
          }
        }
        
        // Get payment mode name
        if (wt.paymentModeId) {
          if (typeof wt.paymentModeId === 'object' && wt.paymentModeId.modeName) {
            accountName = wt.paymentModeId.modeName;
          } else {
            const paymentMode = await getPaymentModeObject(wt.paymentModeId);
            if (paymentMode) {
              accountName = paymentMode.modeName;
            }
          }
        }
        
        // Determine transaction type display
        const typeDisplay = wt.type === 'add' ? 'Add Amount' : 'Withdraw';
        
        // Get performer name
        const performerName = wt.performedBy 
          ? (wt.performedBy.name || 'SuperAdmin')
          : 'SuperAdmin';
        
        // Get user name
        const userName = wt.userId 
          ? (wt.userId.name || 'Unknown User')
          : 'Unknown User';
        
        // Determine From → To display
        // Add Amount: SuperAdmin (performer) → User's Wallet
        // Withdraw: User's Wallet → SuperAdmin (performer)
        const fromName = wt.type === 'add' ? performerName : `${userName}'s Wallet`;
        const toName = wt.type === 'add' ? `${userName}'s Wallet` : performerName;
        
        return {
          id: wt._id,
          type: typeDisplay,
          date: wt.createdAt,
          createdAt: wt.createdAt,
          user: wt.userId ? {
            id: wt.userId._id,
            name: wt.userId.name,
            email: wt.userId.email,
            role: wt.userId.role
          } : null,
          performedBy: wt.performedBy ? {
            id: wt.performedBy._id,
            name: wt.performedBy.name,
            email: wt.performedBy.email,
            role: wt.performedBy.role
          } : null,
          from: fromName,
          to: toName,
          amount: wt.amount,
          mode: wt.mode,
          paymentModeId: wt.paymentModeId ? (wt.paymentModeId._id || wt.paymentModeId.toString() || wt.paymentModeId) : null,
          paymentMode: await getPaymentModeObject(wt.paymentModeId),
          status: 'Completed',
          accountId: extractedAccountId,
          accountName: accountName,
          notes: wt.notes || '',
          operation: wt.operation,
          walletTransactionType: wt.type
        };
      })
    );
    
    // Calculate summary statistics for transactions
    const addAmountCount = transformedTransactions.filter(t => t.type === 'Add Amount').length;
    const addAmountTotal = transformedTransactions
      .filter(t => t.type === 'Add Amount')
      .reduce((sum, t) => sum + toSafeNumber(t.amount), 0);
    
    const withdrawCount = transformedTransactions.filter(t => t.type === 'Withdraw').length;
    const withdrawTotal = transformedTransactions
      .filter(t => t.type === 'Withdraw')
      .reduce((sum, t) => sum + toSafeNumber(t.amount), 0);
    
    console.log(`📊 [ALL WALLET REPORTS] Transaction Summary:`);
    console.log(`   Add Amount: ${addAmountCount} transactions, Total: ₹${addAmountTotal}`);
    console.log(`   Withdraw: ${withdrawCount} transactions, Total: ₹${withdrawTotal}`);
    
    const response = {
      success: true,
      report: {
        ...report,
        addAmountCount,
        addAmountTotal,
        withdrawCount,
        withdrawTotal
      },
      transactions: transformedTransactions,
      filters: {
        userId: userId || null,
        startDate: startDate || null,
        endDate: endDate || null,
        accountId: accountId || null
      },
      userCount: userCount,
      transactionCount: transformedTransactions.length,
      lastUpdated: new Date().toISOString()
    };
    
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📊 [ALL WALLET REPORTS] Response sent:');
    console.log('   success: true');
    console.log('   report:', JSON.stringify(response.report, null, 2));
    console.log('   userCount:', userCount);
    console.log('   transactionCount:', response.transactionCount);
    console.log('   transactions:', transformedTransactions.length, 'entries');
    console.log('   filters:', JSON.stringify(response.filters, null, 2));
    console.log('═══════════════════════════════════════════════════════════');
    
    res.status(200).json(response);
  } catch (error) {
    console.error('❌ [ALL WALLET REPORTS] Error in getAllWalletReportsWithFilters:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch wallet reports'
    });
  }
};

// Export helper functions for use in other modules (e.g., Socket.IO updates)
exports.calculateAllUsersTotals = calculateAllUsersTotals;
exports.calculateUserTotals = calculateUserTotals;

