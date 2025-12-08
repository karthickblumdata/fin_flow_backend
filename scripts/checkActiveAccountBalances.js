const mongoose = require('mongoose');
const Collection = require('../models/collectionModel');
const WalletTransaction = require('../models/walletTransactionModel');
const PaymentMode = require('../models/paymentModeModel');
require('dotenv').config();

async function calculateAccountBalance(accountId, accountName) {
  let cashIn = 0;
  let cashOut = 0;

  // 1. Get Collections with this paymentModeId (only approved/accounted/verified)
  const collections = await Collection.find({
    paymentModeId: new mongoose.Types.ObjectId(accountId),
    status: { $in: ['Approved', 'Verified', 'Accounted'] }
  });

  collections.forEach(col => {
    cashIn += parseFloat(col.amount) || 0;
  });

  // 2. Get Wallet Transactions (Add Amount/Withdraw) for this account
  const walletTransactions = await WalletTransaction.find({
    $or: [
      { notes: { $regex: `account\\s+${accountId}`, $options: 'i' } }
    ]
  });

  walletTransactions.forEach(wt => {
    const amount = parseFloat(wt.amount) || 0;
    const type = (wt.type || '').toLowerCase();
    const notes = wt.notes || '';
    const accountIdInNotes = notes.match(/account\s+([^\s]+)/i);
    
    if (accountIdInNotes && accountIdInNotes[1] === accountId) {
      if (type === 'add') {
        cashIn += amount;
      } else if (type === 'withdraw') {
        cashOut += amount;
      }
    }
  });

  const balance = cashIn - cashOut;
  return { accountName, accountId, cashIn, cashOut, balance, collectionsCount: collections.length, walletTransactionsCount: walletTransactions.length };
}

async function main() {
  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/financial_flow';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');

    // Get all active payment modes
    const activeAccounts = await PaymentMode.find({ isActive: true }).sort({ createdAt: -1 });
    
    console.log(`📊 Found ${activeAccounts.length} active accounts:\n`);
    
    const results = [];
    
    for (const account of activeAccounts) {
      const result = await calculateAccountBalance(account._id.toString(), account.modeName);
      results.push(result);
    }

    // Display results
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📊 ACTIVE ACCOUNTS BALANCE SUMMARY');
    console.log('═══════════════════════════════════════════════════════════\n');
    
    results.forEach((result, index) => {
      console.log(`${index + 1}. ${result.accountName}`);
      console.log(`   Account ID: ${result.accountId}`);
      console.log(`   Cash In:  ₹${result.cashIn.toFixed(2)}`);
      console.log(`   Cash Out: ₹${result.cashOut.toFixed(2)}`);
      console.log(`   Balance:  ₹${result.balance.toFixed(2)}`);
      console.log(`   Collections: ${result.collectionsCount}, Wallet Transactions: ${result.walletTransactionsCount}`);
      console.log('');
    });

    console.log('═══════════════════════════════════════════════════════════\n');

    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();

