#!/usr/bin/env node

/**
 * Seeds two dummy pending approval records (one transaction, one expense)
 * so the Smart View screen always has sample data to display.
 *
 * Safe to run multiple times – existing demo entries are reused.
 */

require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/userModel');
const Transaction = require('../models/transactionModel');
const Expense = require('../models/expenseModel');

const SEED_LABEL = 'Smart View Demo';

const USERS = [
  {
    name: 'Demo Super Admin',
    email: 'demo.superadmin@example.com',
    role: 'SuperAdmin',
  },
  {
    name: 'Demo Admin',
    email: 'demo.admin@example.com',
    role: 'Admin',
  },
  {
    name: 'Demo Staff',
    email: 'demo.staff@example.com',
    role: 'Staff',
  },
];

const transactionSeeds = [
  {
    purpose: `${SEED_LABEL} Transfer`,
    amount: 1250,
    mode: 'UPI',
    notes: 'Demo pending transaction for Smart View testing.',
  },
];

const expenseSeeds = [
  {
    description: `${SEED_LABEL} Expense`,
    amount: 420,
    mode: 'Cash',
    category: 'Marketing',
    notes: 'Demo pending expense for Smart View testing.',
  },
];

async function ensureUser({ name, email, role }) {
  let user = await User.findOne({ email });
  if (user) {
    return user;
  }

  user = await User.create({
    name,
    email,
    password: 'Password@123',
    role,
    isVerified: true,
  });

  return user;
}

async function seedTransactions({ initiatedBy, sender, receiver }) {
  const records = [];

  const allowedPurposes = transactionSeeds.map((seed) => seed.purpose);

  for (const seed of transactionSeeds) {
    const updated = await Transaction.findOneAndUpdate(
      { purpose: seed.purpose },
      {
        $set: {
          initiatedBy,
          sender,
          receiver,
          amount: seed.amount,
          mode: seed.mode,
          purpose: seed.purpose,
          status: 'Pending',
          proofUrl: 'https://via.placeholder.com/480x320.png?text=Transaction',
          isAutoPay: false,
          isSystemTransaction: false,
        },
        $unset: {
          flagReason: '',
          approvedBy: '',
          approvedAt: '',
        },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      },
    );

    records.push(updated);
  }

  await Transaction.deleteMany({
    purpose: /Smart View Demo/,
    purpose: { $nin: allowedPurposes },
  });

  return records;
}

async function seedExpenses({ createdBy, userId }) {
  const records = [];

  const allowedDescriptions = expenseSeeds.map((seed) => seed.description);

  for (const seed of expenseSeeds) {
    const updated = await Expense.findOneAndUpdate(
      { description: seed.description },
      {
        $set: {
          createdBy,
          userId,
          category: seed.category,
          amount: seed.amount,
          mode: seed.mode,
          description: seed.description,
          status: 'Pending',
          proofUrl: 'https://via.placeholder.com/480x320.png?text=Expense',
        },
        $unset: {
          flagReason: '',
          approvedBy: '',
          approvedAt: '',
        },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      },
    );

    records.push(updated);
  }

  await Expense.deleteMany({
    description: /Smart View Demo/,
    description: { $nin: allowedDescriptions },
  });

  return records;
}

async function main() {
  await connectDB();

  try {
    const [superAdmin, admin, staff] = await Promise.all(
      USERS.map((details) => ensureUser(details)),
    );

    const [transactions, expenses] = await Promise.all([
      seedTransactions({
        initiatedBy: admin._id,
        sender: admin._id,
        receiver: staff._id,
      }),
      seedExpenses({
        createdBy: admin._id,
        userId: staff._id,
      }),
    ]);

    console.log('\n✅ Seed complete:');
    console.log(`   Transactions seeded: ${transactions.length}`);
    console.log(`   Expenses seeded    : ${expenses.length}`);
    console.log('\nUse these demo entries to test approve, reject, flag, edit, and delete workflows.');
  } catch (error) {
    console.error('\n❌ Seed failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
}

main();

