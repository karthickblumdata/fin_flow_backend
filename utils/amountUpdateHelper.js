const Wallet = require('../models/walletModel');
const User = require('../models/userModel');
const { emitAmountUpdate, emitDashboardUpdate } = require('./socketService');

// Calculate total system balance across all wallets
const calculateTotalSystemBalance = async () => {
  try {
    const allWallets = await Wallet.find();
    const totalBalance = allWallets.reduce((sum, wallet) => {
      return sum + (wallet.totalBalance || 0);
    }, 0);

    const cashTotal = allWallets.reduce((sum, wallet) => sum + (wallet.cashBalance || 0), 0);
    const upiTotal = allWallets.reduce((sum, wallet) => sum + (wallet.upiBalance || 0), 0);
    const bankTotal = allWallets.reduce((sum, wallet) => sum + (wallet.bankBalance || 0), 0);

    return {
      totalBalance,
      cashTotal,
      upiTotal,
      bankTotal,
      walletCount: allWallets.length
    };
  } catch (error) {
    console.error('Error calculating total system balance:', error);
    return {
      totalBalance: 0,
      cashTotal: 0,
      upiTotal: 0,
      bankTotal: 0,
      walletCount: 0
    };
  }
};

// Emit amount update to super admin with full system stats
const notifyAmountUpdate = async (updateType, details) => {
  try {
    const systemBalance = await calculateTotalSystemBalance();
    
    const updateData = {
      type: updateType, // 'wallet_add', 'wallet_withdraw', 'transaction', 'collection', 'expense'
      details,
      systemBalance
    };

    emitAmountUpdate(updateData);
    
    // Also emit dashboard update with summary stats
    await emitDashboardStats();
  } catch (error) {
    console.error('Error notifying amount update:', error);
  }
};

// Emit dashboard stats update
const emitDashboardStats = async () => {
  try {
    const Transaction = require('../models/transactionModel');
    const Collection = require('../models/collectionModel');
    const Expense = require('../models/expenseModel');
    const User = require('../models/userModel');

    const systemBalance = await calculateTotalSystemBalance();
    
    const stats = {
      totalBalance: systemBalance.totalBalance,
      totalUsers: await User.countDocuments(),
      totalTransactions: await Transaction.countDocuments(),
      totalCollections: await Collection.countDocuments(),
      totalExpenses: await Expense.countDocuments(),
      pendingTransactions: await Transaction.countDocuments({ status: 'Pending' }),
      pendingCollections: await Collection.countDocuments({ status: 'Pending' }),
      pendingExpenses: await Expense.countDocuments({ status: 'Pending' }),
      systemBalance
    };

    emitDashboardUpdate(stats);
  } catch (error) {
    console.error('Error emitting dashboard stats:', error);
  }
};

module.exports = {
  calculateTotalSystemBalance,
  notifyAmountUpdate,
  emitDashboardStats
};
