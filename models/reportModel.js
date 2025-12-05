const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  reportName: {
    type: String,
    required: true,
    trim: true
  },
  reportType: {
    type: String,
    enum: ['expense', 'transaction', 'collection', 'combined'],
    default: 'combined'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  filters: {
    startDate: Date,
    endDate: Date,
    mode: {
      type: String,
      enum: ['Cash', 'UPI', 'Bank', null]
    },
    status: String,
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    category: String,
    initiatedBy: String,
    transferTo: String,
    purpose: String,
    type: String,
    collectionType: String
  },
  summary: {
    totalExpenses: { type: Number, default: 0 },
    totalTransactions: { type: Number, default: 0 },
    totalCollections: { type: Number, default: 0 },
    netFlow: { type: Number, default: 0 },
    expenseCount: { type: Number, default: 0 },
    transactionCount: { type: Number, default: 0 },
    collectionCount: { type: Number, default: 0 },
    totalInflow: { type: Number, default: 0 },
    totalOutflow: { type: Number, default: 0 },
    pendingApprovals: { type: Number, default: 0 }
  },
  snapshot: {
    expenses: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Expense'
    }],
    transactions: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transaction'
    }],
    collections: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Collection'
    }]
  },
  includeFullData: {
    type: Boolean,
    default: false
  },
  fullData: {
    expenses: [mongoose.Schema.Types.Mixed],
    transactions: [mongoose.Schema.Types.Mixed],
    collections: [mongoose.Schema.Types.Mixed]
  },
  isTemplate: {
    type: Boolean,
    default: false
  },
  tags: [{
    type: String,
    trim: true
  }],
  notes: {
    type: String,
    default: '',
    trim: true
  },
  generatedAt: {
    type: Date,
    default: Date.now
  },
  expiresAt: Date
}, {
  timestamps: true
});

// Indexes for efficient queries
reportSchema.index({ createdBy: 1, createdAt: -1 });
reportSchema.index({ reportType: 1, createdAt: -1 });
reportSchema.index({ isTemplate: 1, createdAt: -1 });
reportSchema.index({ 'filters.startDate': 1, 'filters.endDate': 1 });

module.exports = mongoose.model('Report', reportSchema);

