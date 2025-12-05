#!/usr/bin/env node

require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Transaction = require('../models/transactionModel');
const Collection = require('../models/collectionModel');
const Expense = require('../models/expenseModel');

async function main() {
  await connectDB();

  try {
    const [transactionCount, collectionCount, expenseCount, demoTransactions, demoExpenses] = await Promise.all([
      Transaction.countDocuments({ status: 'Pending' }),
      Collection.countDocuments({ status: 'Pending' }),
      Expense.countDocuments({ status: 'Pending' }),
      Transaction.find({ purpose: /Smart View Demo/ }).select('purpose status createdAt').lean(),
      Expense.find({ description: /Smart View Demo/ }).select('description status createdAt').lean(),
    ]);

    console.log('\nPending counts:');
    console.log(`  Transactions: ${transactionCount}`);
    console.log(`  Collections : ${collectionCount}`);
    console.log(`  Expenses    : ${expenseCount}`);
    console.log(`  Total       : ${transactionCount + collectionCount + expenseCount}\n`);

    if (demoTransactions.length) {
      console.log('Smart View Demo transactions:');
      demoTransactions.forEach((tx) => {
        console.log(`  - ${tx.purpose} :: ${tx.status} (${tx.createdAt.toISOString()})`);
      });
      console.log('');
    } else {
      console.log('No Smart View Demo transactions found.\n');
    }

    if (demoExpenses.length) {
      console.log('Smart View Demo expenses:');
      demoExpenses.forEach((exp) => {
        console.log(`  - ${exp.description} :: ${exp.status} (${exp.createdAt.toISOString()})`);
      });
      console.log('');
    } else {
      console.log('No Smart View Demo expenses found.\n');
    }
  } catch (error) {
    console.error('Failed to check pending counts:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
}

main();

