const mongoose = require('mongoose');
const Collection = require('../models/collectionModel');
const WalletTransaction = require('../models/walletTransactionModel');
require('dotenv').config();

// Payment Mode IDs from the images
const CASH_ACCOUNT_ID = '6925b6ddee902cabea76d0d7';
const COMPANY_UPI_ACCOUNT_ID = '6925b7e6ee902cabea76d136';

async function calculateAccountBalance(accountId, accountName) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 Calculating Balance for: ${accountName}`);
  console.log(`   Account ID: ${accountId}`);
  console.log(`${'='.repeat(60)}\n`);

  let cashIn = 0;
  let cashOut = 0;

  // 1. Get Collections with this paymentModeId
  const collections = await Collection.find({
    paymentModeId: new mongoose.Types.ObjectId(accountId)
  }).populate('paymentModeId', 'modeName');

  console.log(`📦 Collections found: ${collections.length}`);
  
  collections.forEach(col => {
    const amount = parseFloat(col.amount) || 0;
    const status = (col.status || '').toLowerCase();
    
    // Only count approved/accounted/verified collections as Cash In
    if (status === 'approved' || status === 'accounted' || status === 'verified') {
      cashIn += amount;
      console.log(`   ✅ Collection: ₹${amount} (${col.status}) - Added to Cash In`);
    } else {
      console.log(`   ⏸️  Collection: ₹${amount} (${col.status}) - Not counted (pending/unaccounted)`);
    }
  });

  // 2. Get Wallet Transactions (Add Amount/Withdraw) for this account
  // Find by accountId in notes field
  const walletTransactions = await WalletTransaction.find({
    $or: [
      { notes: { $regex: accountId, $options: 'i' } },
      { notes: { $regex: new RegExp(accountId, 'i') } }
    ]
  });

  console.log(`\n💰 Wallet Transactions found: ${walletTransactions.length}`);

  walletTransactions.forEach(wt => {
    const amount = parseFloat(wt.amount) || 0;
    const type = (wt.type || '').toLowerCase();
    
    // Extract accountId from notes to verify it matches
    const notes = wt.notes || '';
    const accountIdInNotes = notes.match(/account\s+([^\s]+)/i);
    
    if (accountIdInNotes && accountIdInNotes[1] === accountId) {
      if (type === 'add') {
        cashIn += amount;
        console.log(`   ✅ Add Amount: ₹${amount} - Added to Cash In`);
      } else if (type === 'withdraw') {
        cashOut += amount;
        console.log(`   ✅ Withdraw: ₹${amount} - Added to Cash Out`);
      }
    } else {
      console.log(`   ⚠️  Wallet Transaction: ₹${amount} (${type}) - Account ID mismatch, skipped`);
    }
  });

  const balance = cashIn - cashOut;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 SUMMARY for ${accountName}:`);
  console.log(`   Cash In:  ₹${cashIn.toFixed(2)}`);
  console.log(`   Cash Out: ₹${cashOut.toFixed(2)}`);
  console.log(`   Balance:  ₹${balance.toFixed(2)}`);
  console.log(`${'='.repeat(60)}\n`);

  return {
    accountName,
    accountId,
    cashIn,
    cashOut,
    balance,
    collectionsCount: collections.length,
    walletTransactionsCount: walletTransactions.length
  };
}

async function main() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/your-database';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    // Calculate for Cash
    const cashResult = await calculateAccountBalance(CASH_ACCOUNT_ID, 'Cash');

    // Calculate for Company Upi
    const companyUpiResult = await calculateAccountBalance(COMPANY_UPI_ACCOUNT_ID, 'Company Upi');

    // Final Summary
    console.log(`\n${'='.repeat(60)}`);
    console.log('📊 FINAL SUMMARY');
    console.log(`${'='.repeat(60)}`);
    console.log('\n💰 CASH ACCOUNT:');
    console.log(`   Cash In:  ₹${cashResult.cashIn.toFixed(2)}`);
    console.log(`   Cash Out: ₹${cashResult.cashOut.toFixed(2)}`);
    console.log(`   Balance:  ₹${cashResult.balance.toFixed(2)}`);
    console.log(`   Collections: ${cashResult.collectionsCount}`);
    console.log(`   Wallet Transactions: ${cashResult.walletTransactionsCount}`);

    console.log('\n💳 COMPANY UPI ACCOUNT:');
    console.log(`   Cash In:  ₹${companyUpiResult.cashIn.toFixed(2)}`);
    console.log(`   Cash Out: ₹${companyUpiResult.cashOut.toFixed(2)}`);
    console.log(`   Balance:  ₹${companyUpiResult.balance.toFixed(2)}`);
    console.log(`   Collections: ${companyUpiResult.collectionsCount}`);
    console.log(`   Wallet Transactions: ${companyUpiResult.walletTransactionsCount}`);
    console.log(`\n${'='.repeat(60)}\n`);

    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();

