const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  initiatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  receiver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  mode: {
    type: String,
    enum: ['Cash', 'UPI', 'Bank'],
    required: true
  },
  purpose: {
    type: String,
    trim: true
  },
  status: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected', 'Cancelled', 'Completed', 'Flagged'],
    default: 'Pending'
  },
  proofUrl: {
    type: String
  },
  flagReason: {
    type: String
  },
  flaggedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  flaggedAt: {
    type: Date
  },
  response: {
    type: String,
    trim: true
  },
  responseDate: {
    type: Date
  },
  isAutoPay: {
    type: Boolean,
    default: false
  },
  isSystemTransaction: {
    type: Boolean,
    default: false
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedAt: {
    type: Date
  },
  linkedCollectionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Collection'
  }
}, {
  timestamps: true
});

transactionSchema.index({ sender: 1, createdAt: -1 });
transactionSchema.index({ receiver: 1, status: 1 });
transactionSchema.index({ status: 1 });
transactionSchema.index({ initiatedBy: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);
