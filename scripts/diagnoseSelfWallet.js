#!/usr/bin/env node

/**
 * Diagnostic Script: Self Wallet Data Check
 * 
 * This script checks:
 * 1. If user exists and is logged in
 * 2. If wallet document exists for user
 * 3. What expenses, transactions, collections, and wallet transactions exist for the user
 * 4. What the API endpoint would return
 */

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/userModel');
const Wallet = require('../models/walletModel');
const Expense = require('../models/expenseModel');
const Transaction = require('../models/transactionModel');
const Collection = require('../models/collectionModel');
const WalletTransaction = require('../models/walletTransactionModel');
const { getOrCreateWallet } = require('../utils/walletHelper');

// Helper function to normalize status
function normalizeStatusKey(status) {
  if (!status) return '';
  const normalized = status.toLowerCase().trim();
  const statusMap = {
    'approved': 'approved',
    'completed': 'approved',
    'verified': 'accounted',
    'accounted': 'accounted',
    'pending': 'unapproved',
    'unapproved': 'unapproved',
    'unaccounted': 'unaccounted',
    'flagged': 'flagged',
    'rejected': 'rejected'
  };
  return statusMap[normalized] || normalized;
}

// Helper function to safely convert to number
function toSafeNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  const num = typeof value === 'number' ? value : parseFloat(value);
  return isNaN(num) ? 0 : num;
}

async function diagnoseSelfWallet(userEmail) {
  try {
    console.log('\n' + '='.repeat(80));
    console.log('🔍 SELF WALLET DATA DIAGNOSTIC REPORT');
    console.log('='.repeat(80));
    console.log(`📧 Checking for user: ${userEmail || 'NOT SPECIFIED'}\n`);

    // Connect to database
    await connectDB();
    console.log('✅ Connected to MongoDB\n');

    // Find user by email
    let user;
    if (userEmail) {
      user = await User.findOne({ email: userEmail });
    } else {
      // Get first verified user as example
      user = await User.findOne({ isVerified: true });
      if (user) {
        console.log(`⚠️  No email provided, using first verified user: ${user.email}\n`);
      }
    }

    if (!user) {
      console.log('❌ ERROR: User not found!');
      console.log('\n💡 Please provide a valid user email or ensure users exist in database.');
      console.log('   Usage: node scripts/diagnoseSelfWallet.js <user-email>');
      await mongoose.connection.close();
      process.exit(1);
    }

    const userId = user._id;
    
    console.log('👤 USER INFORMATION:');
    console.log('   ID:', userId.toString());
    console.log('   Name:', user.name);
    console.log('   Email:', user.email);
    console.log('   Role:', user.role);
    console.log('   Verified:', user.isVerified ? '✅ Yes' : '❌ No');
    console.log('');

    // Check wallet
    console.log('💰 WALLET CHECK:');
    let wallet = await Wallet.findOne({ userId: userId });
    
    if (!wallet) {
      console.log('   Status: ❌ Wallet document NOT found');
      console.log('   Action: Creating wallet using getOrCreateWallet...');
      wallet = await getOrCreateWallet(userId);
      console.log('   ✅ Wallet created successfully');
    } else {
      console.log('   Status: ✅ Wallet document found');
    }
    
    console.log('   Cash Balance:', wallet.cashBalance || 0);
    console.log('   UPI Balance:', wallet.upiBalance || 0);
    console.log('   Bank Balance:', wallet.bankBalance || 0);
    console.log('   Total Balance:', wallet.totalBalance || 0);
    console.log('   Cash In:', wallet.cashIn || 0);
    console.log('   Cash Out:', wallet.cashOut || 0);
    console.log('');

    // Check expenses
    console.log('📝 EXPENSES CHECK:');
    const expenses = await Expense.find({ userId: userId })
      .populate('userId', 'name email')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .lean();
    
    console.log(`   Total Count: ${expenses.length}`);
    
    if (expenses.length > 0) {
      const expensesByStatus = {};
      let totalAmount = 0;
      expenses.forEach(exp => {
        const status = exp.status || 'Unknown';
        if (!expensesByStatus[status]) {
          expensesByStatus[status] = { count: 0, amount: 0 };
        }
        expensesByStatus[status].count++;
        const amount = toSafeNumber(exp.amount);
        expensesByStatus[status].amount += amount;
        totalAmount += amount;
      });
      
      console.log('   By Status:');
      Object.keys(expensesByStatus).forEach(status => {
        const stats = expensesByStatus[status];
        console.log(`     - ${status}: ${stats.count} items, ₹${stats.amount.toFixed(2)}`);
      });
      console.log(`   Total Amount: ₹${totalAmount.toFixed(2)}`);
      
      console.log('\n   Recent Expenses (last 5):');
      expenses.slice(0, 5).forEach((exp, idx) => {
        console.log(`     ${idx + 1}. ₹${toSafeNumber(exp.amount).toFixed(2)} - ${exp.category || 'N/A'} - ${exp.status || 'N/A'} - ${exp.createdAt ? new Date(exp.createdAt).toLocaleDateString() : 'N/A'}`);
      });
    } else {
      console.log('   ⚠️  No expenses found for this user');
    }
    console.log('');

    // Check transactions
    console.log('💸 TRANSACTIONS CHECK:');
    const transactions = await Transaction.find({
      $or: [
        { sender: userId },
        { receiver: userId }
      ]
    })
      .populate('sender', 'name email')
      .populate('receiver', 'name email')
      .sort({ createdAt: -1 })
      .lean();
    
    console.log(`   Total Count: ${transactions.length}`);
    
    if (transactions.length > 0) {
      const transactionsAsSender = transactions.filter(t => 
        (t.sender && (typeof t.sender === 'object' ? t.sender._id.toString() : t.sender.toString()) === userId.toString())
      );
      const transactionsAsReceiver = transactions.filter(t => 
        (t.receiver && (typeof t.receiver === 'object' ? t.receiver._id.toString() : t.receiver.toString()) === userId.toString())
      );
      
      console.log(`   As Sender: ${transactionsAsSender.length}`);
      console.log(`   As Receiver: ${transactionsAsReceiver.length}`);
      
      const transactionsByStatus = {};
      transactions.forEach(tx => {
        const status = tx.status || 'Unknown';
        if (!transactionsByStatus[status]) {
          transactionsByStatus[status] = { count: 0, amount: 0 };
        }
        transactionsByStatus[status].count++;
        const amount = toSafeNumber(tx.amount);
        transactionsByStatus[status].amount += amount;
      });
      
      console.log('   By Status:');
      Object.keys(transactionsByStatus).forEach(status => {
        const stats = transactionsByStatus[status];
        console.log(`     - ${status}: ${stats.count} items, ₹${stats.amount.toFixed(2)}`);
      });
      
      console.log('\n   Recent Transactions (last 5):');
      transactions.slice(0, 5).forEach((tx, idx) => {
        const isSender = tx.sender && (typeof tx.sender === 'object' ? tx.sender._id.toString() : tx.sender.toString()) === userId.toString();
        const role = isSender ? 'Sender' : 'Receiver';
        console.log(`     ${idx + 1}. ₹${toSafeNumber(tx.amount).toFixed(2)} - ${role} - ${tx.status || 'N/A'} - ${tx.createdAt ? new Date(tx.createdAt).toLocaleDateString() : 'N/A'}`);
      });
    } else {
      console.log('   ⚠️  No transactions found for this user');
    }
    console.log('');

    // Check collections
    console.log('💵 COLLECTIONS CHECK:');
    const collections = await Collection.find({
      $or: [
        { collectedBy: userId },
        { assignedReceiver: userId }
      ]
    })
      .populate('collectedBy', 'name email')
      .populate('assignedReceiver', 'name email')
      .sort({ createdAt: -1 })
      .lean();
    
    console.log(`   Total Count: ${collections.length}`);
    
    if (collections.length > 0) {
      const collectionsAsCollector = collections.filter(c => 
        c.collectedBy && (typeof c.collectedBy === 'object' ? c.collectedBy._id.toString() : c.collectedBy.toString()) === userId.toString()
      );
      const collectionsAsReceiver = collections.filter(c => 
        c.assignedReceiver && (typeof c.assignedReceiver === 'object' ? c.assignedReceiver._id.toString() : c.assignedReceiver.toString()) === userId.toString()
      );
      
      console.log(`   As Collector: ${collectionsAsCollector.length}`);
      console.log(`   As Assigned Receiver: ${collectionsAsReceiver.length}`);
      
      const collectionsByStatus = {};
      collections.forEach(col => {
        const status = col.status || 'Unknown';
        if (!collectionsByStatus[status]) {
          collectionsByStatus[status] = { count: 0, amount: 0 };
        }
        collectionsByStatus[status].count++;
        const amount = toSafeNumber(col.amount);
        collectionsByStatus[status].amount += amount;
      });
      
      console.log('   By Status:');
      Object.keys(collectionsByStatus).forEach(status => {
        const stats = collectionsByStatus[status];
        console.log(`     - ${status}: ${stats.count} items, ₹${stats.amount.toFixed(2)}`);
      });
      
      console.log('\n   Recent Collections (last 5):');
      collections.slice(0, 5).forEach((col, idx) => {
        console.log(`     ${idx + 1}. ₹${toSafeNumber(col.amount).toFixed(2)} - ${col.status || 'N/A'} - ${col.createdAt ? new Date(col.createdAt).toLocaleDateString() : 'N/A'}`);
      });
    } else {
      console.log('   ⚠️  No collections found for this user');
    }
    console.log('');

    // Check wallet transactions
    console.log('🔄 WALLET TRANSACTIONS CHECK:');
    const walletTransactions = await WalletTransaction.find({ userId: userId })
      .populate('performedBy', 'name email')
      .sort({ createdAt: -1 })
      .lean();
    
    console.log(`   Total Count: ${walletTransactions.length}`);
    
    if (walletTransactions.length > 0) {
      const addTransactions = walletTransactions.filter(wt => 
        (wt.type === 'add' || wt.operation === 'add') && wt.status === 'completed'
      );
      const withdrawTransactions = walletTransactions.filter(wt => 
        (wt.type === 'withdraw' || wt.operation === 'subtract') && wt.status === 'completed'
      );
      
      console.log(`   Add Operations: ${addTransactions.length}`);
      console.log(`   Withdraw Operations: ${withdrawTransactions.length}`);
      
      const addAmount = addTransactions.reduce((sum, wt) => sum + toSafeNumber(wt.amount), 0);
      const withdrawAmount = withdrawTransactions.reduce((sum, wt) => sum + toSafeNumber(wt.amount), 0);
      
      console.log(`   Total Added: ₹${addAmount.toFixed(2)}`);
      console.log(`   Total Withdrawn: ₹${withdrawAmount.toFixed(2)}`);
      
      console.log('\n   Recent Wallet Transactions (last 5):');
      walletTransactions.slice(0, 5).forEach((wt, idx) => {
        console.log(`     ${idx + 1}. ₹${toSafeNumber(wt.amount).toFixed(2)} - ${wt.type || 'N/A'} - ${wt.operation || 'N/A'} - ${wt.status || 'N/A'} - ${wt.createdAt ? new Date(wt.createdAt).toLocaleDateString() : 'N/A'}`);
      });
    } else {
      console.log('   ⚠️  No wallet transactions found for this user');
    }
    console.log('');

    // Simulate API calculation
    console.log('📊 CALCULATED SUMMARY (as per API logic):');
    
    // Calculate Cash In
    let cashIn = 0;
    
    // 1. Wallet Transactions - Add operations
    walletTransactions.forEach(wt => {
      if ((wt.type === 'add' || wt.operation === 'add') && wt.status === 'completed') {
        cashIn += toSafeNumber(wt.amount);
      }
    });
    
    // 2. Transactions - Where user is receiver
    transactions.forEach(t => {
      const isReceiver = t.receiver && (
        (typeof t.receiver === 'object' && t.receiver._id && t.receiver._id.toString() === userId.toString()) ||
        (typeof t.receiver === 'string' && t.receiver === userId.toString()) ||
        (t.receiver.toString() === userId.toString())
      );
      
      if (isReceiver && (t.status === 'Approved' || t.status === 'Completed')) {
        cashIn += toSafeNumber(t.amount);
      }
    });
    
    // 3. Collections - Where user is collector or assigned receiver
    collections.forEach(c => {
      const isCollector = c.collectedBy && (
        (typeof c.collectedBy === 'object' && c.collectedBy._id && c.collectedBy._id.toString() === userId.toString()) ||
        (typeof c.collectedBy === 'string' && c.collectedBy === userId.toString()) ||
        (c.collectedBy.toString() === userId.toString())
      );
      const isAssignedReceiver = c.assignedReceiver && (
        (typeof c.assignedReceiver === 'object' && c.assignedReceiver._id && c.assignedReceiver._id.toString() === userId.toString()) ||
        (typeof c.assignedReceiver === 'string' && c.assignedReceiver === userId.toString()) ||
        (c.assignedReceiver.toString() === userId.toString())
      );

      if ((isCollector || isAssignedReceiver) && (c.status === 'Approved' || c.status === 'Verified')) {
        cashIn += toSafeNumber(c.amount);
      }
    });
    
    // Calculate Cash Out - ONLY for logged-in user (matching API endpoint logic)
    let cashOut = 0;
    
    // Track which expenses/transactions already have corresponding wallet transactions to avoid double counting
    const expensesWithWalletTransactions = new Set();
    const transactionsWithWalletTransactions = new Set();
    
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
        
        // Track wallet transactions related to expenses to avoid double counting
        if (wt.type === 'expense' && wt.relatedId) {
          expensesWithWalletTransactions.add(wt.relatedId.toString());
        }
        
        // Track wallet transactions related to transactions to avoid double counting
        // When a Transaction is processed, it creates a WalletTransaction with type='transaction'
        // So we should NOT count the Transaction document separately if it has a wallet transaction
        if (wt.type === 'transaction' && wt.relatedId) {
          transactionsWithWalletTransactions.add(wt.relatedId.toString());
        }
      }
    });
    
    // 2. Transactions - ONLY where logged-in user is sender (money going out)
    // Do NOT count transactions that already have a corresponding wallet transaction
    // (those are already counted in step 1 above to avoid double counting in cash out)
    transactions.forEach(t => {
      const transactionId = t._id ? t._id.toString() : null;
      const hasWalletTransaction = transactionId && transactionsWithWalletTransactions.has(transactionId);
      
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
      if (isSender && !isReceiver && (t.status === 'Approved' || t.status === 'Completed')) {
        const amount = toSafeNumber(t.amount);
        
        // IMPORTANT: Only count in cash out if transaction doesn't have a wallet transaction
        // (if it has a wallet transaction, it's already been counted in step 1 above)
        if (!hasWalletTransaction) {
          cashOut += amount;
        }
      }
    });
    
    // 3. Expenses - ONLY expenses belonging to logged-in user
    // Only count expenses that DON'T have corresponding wallet transactions
    // This avoids double counting: if an expense created a wallet transaction (type='expense'),
    // we've already counted it in step 1 above
    expenses.forEach(expense => {
      // Double-check that expense belongs to logged-in user
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
      
      // Only process expenses belonging to logged-in user
      if (!expenseUserId || expenseUserId !== userId.toString()) {
        return; // Skip this expense - it doesn't belong to logged-in user
      }
      
      const expenseId = expense._id ? expense._id.toString() : null;
      const hasWalletTransaction = expenseId && expensesWithWalletTransactions.has(expenseId);
      
      // Only count expense amount in cash out if it doesn't have a corresponding wallet transaction
      // If it does have a wallet transaction, we've already counted it above
      if (!hasWalletTransaction) {
        cashOut += toSafeNumber(expense.amount);
      }
    });
    
    const walletBalance = wallet.totalBalance || ((wallet.cashBalance || 0) + (wallet.upiBalance || 0) + (wallet.bankBalance || 0));
    
    console.log(`   Cash In: ₹${cashIn.toFixed(2)}`);
    console.log(`   Cash Out: ₹${cashOut.toFixed(2)}`);
    console.log(`   Balance: ₹${walletBalance.toFixed(2)}`);
    console.log(`   Total Data Items: ${expenses.length + transactions.length + collections.length + walletTransactions.length}`);
    if (transactionsWithWalletTransactions.size > 0) {
      console.log(`   ⚠️  Note: ${transactionsWithWalletTransactions.size} transaction(s) skipped (already counted as WalletTransactions)`);
    }
    if (expensesWithWalletTransactions.size > 0) {
      console.log(`   ⚠️  Note: ${expensesWithWalletTransactions.size} expense(s) skipped (already counted as WalletTransactions)`);
    }
    console.log('');

    // Summary and recommendations
    console.log('='.repeat(80));
    console.log('📋 DIAGNOSTIC SUMMARY:');
    console.log('='.repeat(80));
    
    const totalDataItems = expenses.length + transactions.length + collections.length + walletTransactions.length;
    
    if (totalDataItems === 0) {
      console.log('❌ ISSUE FOUND: No data exists for this user in the database.');
      console.log('\n💡 RECOMMENDATIONS:');
      console.log('   1. Create some expenses, transactions, collections, or wallet transactions for this user');
      console.log('   2. Check if data exists for other users');
      console.log('   3. Verify user is the correct owner of the data (check userId, collectedBy, assignedReceiver fields)');
    } else if (cashIn === 0 && cashOut === 0 && walletBalance === 0) {
      console.log('⚠️  WARNING: Data exists but all calculated values are zero.');
      console.log(`   - Found ${totalDataItems} data items`);
      console.log('   - But Cash In, Cash Out, and Balance all calculate to ₹0');
      console.log('\n💡 POSSIBLE REASONS:');
      console.log('   1. All transactions are in "Pending" status (only Approved/Completed count as Cash In/Out)');
      console.log('   2. All collections are not Approved/Verified');
      console.log('   3. Wallet transactions are not "completed" status');
      console.log('   4. Amount values are zero or null');
    } else {
      console.log('✅ Data exists and calculations show non-zero values.');
      console.log(`   - Found ${totalDataItems} data items`);
      console.log(`   - Cash In: ₹${cashIn.toFixed(2)}`);
      console.log(`   - Cash Out: ₹${cashOut.toFixed(2)}`);
      console.log(`   - Balance: ₹${walletBalance.toFixed(2)}`);
      console.log('\n💡 If frontend still shows zeros, check:');
      console.log('   1. API endpoint is being called correctly');
      console.log('   2. Frontend is parsing the response correctly');
      console.log('   3. Check browser/Flutter console for errors');
      console.log('   4. Verify authentication token is valid');
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('✅ DIAGNOSTIC COMPLETE');
    console.log('='.repeat(80) + '\n');

    await mongoose.connection.close();
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error.stack);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Get user email from command line argument
const userEmail = process.argv[2];

// Run diagnostic
diagnoseSelfWallet(userEmail);

