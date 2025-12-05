const mongoose = require('mongoose');

const walletTransactionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  walletId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Wallet',
    required: true,
    index: true
  },
  type: {
    type: String,
    required: true,
    enum: ['add', 'withdraw', 'transfer', 'expense', 'collection', 'transaction'],
    index: true
  },
  mode: {
    type: String,
    required: true,
    enum: ['Cash', 'UPI', 'Bank']
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  operation: {
    type: String,
    required: true,
    enum: ['add', 'subtract', 'transfer_in', 'transfer_out']
  },
  // For transfers between modes or users
  fromMode: {
    type: String,
    enum: ['Cash', 'UPI', 'Bank']
  },
  toMode: {
    type: String,
    enum: ['Cash', 'UPI', 'Bank']
  },
  fromUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  toUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  // Reference to related transaction/collection/expense
  relatedId: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'relatedModel'
  },
  relatedModel: {
    type: String,
    enum: ['Transaction', 'Collection', 'Expense', null]
  },
  // Balance after this transaction
  balanceAfter: {
    cashBalance: { type: Number, default: 0 },
    upiBalance: { type: Number, default: 0 },
    bankBalance: { type: Number, default: 0 },
    totalBalance: { type: Number, default: 0 }
  },
  notes: {
    type: String,
    default: ''
  },
  performedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    default: 'completed',
    enum: ['completed', 'pending', 'failed', 'cancelled']
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
walletTransactionSchema.index({ userId: 1, createdAt: -1 });
walletTransactionSchema.index({ walletId: 1, createdAt: -1 });
walletTransactionSchema.index({ type: 1, createdAt: -1 });
walletTransactionSchema.index({ mode: 1, createdAt: -1 });
walletTransactionSchema.index({ createdAt: -1 });

module.exports = mongoose.model('WalletTransaction', walletTransactionSchema);

