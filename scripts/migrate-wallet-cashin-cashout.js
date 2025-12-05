#!/usr/bin/env node

/**
 * Migration script to populate cashIn and cashOut fields for existing wallets
 * 
 * This script calculates cashIn and cashOut from:
 * - Collections (approved/accounted status)
 * - Expenses (approved status)
 * - WalletTransactions (add = cashIn, withdraw = cashOut)
 * - Transactions (receiver = cashIn, sender = cashOut)
 * 
 * Usage: node scripts/migrate-wallet-cashin-cashout.js
 */

require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Wallet = require('../models/walletModel');
const Collection = require('../models/collectionModel');
const Expense = require('../models/expenseModel');
const WalletTransaction = require('../models/walletTransactionModel');
const Transaction = require('../models/transactionModel');

// Helper function to normalize status
function normalizeStatus(status) {
  if (!status) return '';
  const normalized = status.trim().toLowerCase();
  if (normalized === 'accounted' || normalized === 'approved') return 'accounted';
  if (normalized === 'flagged') return 'flagged';
  if (normalized === 'rejected') return 'rejected';
  return 'unaccounted';
}

async function calculateCashInCashOut(userId) {
  let cashIn = 0;
  let cashOut = 0;

  // 1. Collections - Cash In (approved/accounted)
  const collections = await Collection.find({
    collectedBy: userId,
    $or: [
      { status: 'Approved' },
      { status: 'Accounted' }
    ]
  });
  
  collections.forEach(collection => {
    const status = normalizeStatus(collection.status);
    if (status === 'accounted' || status === 'approved') {
      cashIn += collection.amount || 0;
    }
  });

  // 2. Expenses - Cash Out (approved)
  const expenses = await Expense.find({
    userId: userId,
    status: 'Approved'
  });
  
  expenses.forEach(expense => {
    cashOut += expense.amount || 0;
  });

  // 3. WalletTransactions - Add = Cash In, Withdraw = Cash Out
  const walletTransactions = await WalletTransaction.find({
    userId: userId,
    status: 'completed'
  });
  
  walletTransactions.forEach(wt => {
    const amount = wt.amount || 0;
    if (wt.type === 'add' || (wt.type === 'transaction' && wt.operation === 'add')) {
      cashIn += amount;
    } else if (wt.type === 'withdraw' || (wt.type === 'transaction' && wt.operation === 'subtract')) {
      cashOut += amount;
    }
  });

  // 4. Transactions - Receiver = Cash In, Sender = Cash Out
  const transactionsAsReceiver = await Transaction.find({
    receiver: userId,
    $or: [
      { status: 'Approved' },
      { status: 'Completed' }
    ]
  });
  
  transactionsAsReceiver.forEach(transaction => {
    cashIn += transaction.amount || 0;
  });

  const transactionsAsSender = await Transaction.find({
    sender: userId,
    $or: [
      { status: 'Approved' },
      { status: 'Completed' }
    ]
  });
  
  transactionsAsSender.forEach(transaction => {
    cashOut += transaction.amount || 0;
  });

  return { cashIn, cashOut };
}

async function main() {
  try {
    console.log('🔄 Starting migration: Populating cashIn and cashOut for wallets...\n');
    
    await connectDB();
    console.log('✅ Connected to database\n');

    // Get all wallets
    const wallets = await Wallet.find();
    console.log(`📊 Found ${wallets.length} wallets to migrate\n`);

    let updatedCount = 0;
    let skippedCount = 0;

    for (const wallet of wallets) {
      try {
        const userId = wallet.userId;
        
        // Calculate cashIn and cashOut
        const { cashIn, cashOut } = await calculateCashInCashOut(userId);
        
        // Update wallet
        wallet.cashIn = cashIn;
        wallet.cashOut = cashOut;
        await wallet.save();
        
        updatedCount++;
        console.log(`✅ Updated wallet for user ${userId}: cashIn=${cashIn}, cashOut=${cashOut}`);
      } catch (error) {
        console.error(`❌ Error updating wallet ${wallet._id}:`, error.message);
        skippedCount++;
      }
    }

    console.log('\n📊 Migration Summary:');
    console.log(`   Total wallets: ${wallets.length}`);
    console.log(`   ✅ Updated: ${updatedCount}`);
    console.log(`   ⚠️  Skipped: ${skippedCount}`);
    console.log('\n✅ Migration completed successfully!\n');

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error.stack);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Database connection closed');
  }
}

main();

