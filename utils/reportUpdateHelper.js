const Expense = require('../models/expenseModel');
const Transaction = require('../models/transactionModel');
const Collection = require('../models/collectionModel');
const { emitExpenseReportUpdate: emitReportUpdate, emitExpenseReportStatsUpdate: emitReportStatsUpdate } = require('./socketService');

/**
 * Build query object from filters
 * @param {Object} filters - Filter object with startDate, endDate, mode, status
 * @returns {Object} MongoDB query object
 */
function buildQuery(filters = {}) {
  const query = {};
  
  if (filters.startDate || filters.endDate) {
    query.createdAt = {};
    if (filters.startDate) query.createdAt.$gte = new Date(filters.startDate);
    if (filters.endDate) query.createdAt.$lte = new Date(filters.endDate);
  }
  if (filters.mode) query.mode = filters.mode;
  if (filters.status) query.status = filters.status;
  
  return query;
}

/**
 * Calculate and emit full expense report update
 * This includes all expenses, transactions, collections with full data
 * @param {Object} filters - Optional filters (startDate, endDate, mode, status)
 */
const emitExpenseReportUpdate = async (filters = {}) => {
  try {
    const query = buildQuery(filters);
    
    // Fetch all data in parallel for better performance
    const [expenses, transactions, collections] = await Promise.all([
      Expense.find(query)
        .populate('userId', 'name email')
        .sort({ createdAt: -1 })
        .lean(),
      Transaction.find(query)
        .populate('sender', 'name email')
        .populate('receiver', 'name email')
        .sort({ createdAt: -1 })
        .lean(),
      Collection.find(query)
        .populate('collectedBy', 'name email')
        .populate('assignedReceiver', 'name email')
        .sort({ createdAt: -1 })
        .lean()
    ]);

    // Calculate totals
    const totalExpenses = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    const totalTransactions = transactions.reduce((sum, t) => sum + (t.amount || 0), 0);
    const totalCollections = collections.reduce((sum, c) => sum + (c.amount || 0), 0);

    const reportData = {
      expenses: {
        count: expenses.length,
        total: totalExpenses,
        data: expenses
      },
      transactions: {
        count: transactions.length,
        total: totalTransactions,
        data: transactions
      },
      collections: {
        count: collections.length,
        total: totalCollections,
        data: collections
      },
      netFlow: totalCollections - totalExpenses
    };

    emitReportUpdate(reportData);
  } catch (error) {
    console.error('Error emitting expense report update:', error);
  }
};

/**
 * Emit lightweight expense report stats update
 * This only includes summary statistics (count, total) without full data
 * More efficient for frequent updates
 */
const emitExpenseReportStatsUpdate = async () => {
  try {
    // Fetch only counts and totals without full data for better performance
    const [expenses, transactions, collections] = await Promise.all([
      Expense.find().lean(),
      Transaction.find().lean(),
      Collection.find().lean()
    ]);

    // Calculate totals
    const totalExpenses = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    const totalTransactions = transactions.reduce((sum, t) => sum + (t.amount || 0), 0);
    const totalCollections = collections.reduce((sum, c) => sum + (c.amount || 0), 0);

    // Calculate cash in/out balances
    let cashIn = 0;
    let cashOut = 0;
    
    // Collections = Cash In (only approved/verified)
    collections.forEach(col => {
      if (col.status === 'Verified' || col.status === 'Approved') {
        cashIn += col.amount || 0;
      }
    });
    
    // Expenses = Cash Out (only approved/completed)
    expenses.forEach(exp => {
      if (exp.status === 'Approved' || exp.status === 'Completed') {
        cashOut += exp.amount || 0;
      }
    });
    
    // Transactions = cash out (transfers)
    transactions.forEach(tx => {
      if (tx.status === 'Approved' || tx.status === 'Completed') {
        cashOut += tx.amount || 0;
      }
    });
    
    const balance = cashIn - cashOut;
    const netFlow = totalCollections - totalExpenses;

    const stats = {
      expenses: {
        count: expenses.length,
        total: totalExpenses
      },
      transactions: {
        count: transactions.length,
        total: totalTransactions
      },
      collections: {
        count: collections.length,
        total: totalCollections
      },
      summary: {
        cashIn,
        cashOut,
        balance,
        netFlow
      },
      netFlow
    };

    emitReportStatsUpdate(stats);
  } catch (error) {
    console.error('Error emitting expense report stats update:', error);
  }
};

module.exports = {
  emitExpenseReportUpdate,
  emitExpenseReportStatsUpdate
};

