const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  category: {
    type: String,
    required: true,
    trim: true
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
  description: {
    type: String,
    required: false, // Optional - Super Admin can create expenses without description
    default: '', // Default to empty string if not provided
    trim: true
  },
  proofUrl: {
    type: String
  },
  status: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected', 'Flagged'],
    default: 'Pending'
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
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedAt: {
    type: Date
  }
}, {
  timestamps: true
});

expenseSchema.index({ userId: 1, createdAt: -1 });
expenseSchema.index({ status: 1 });
expenseSchema.index({ category: 1 });
expenseSchema.index({ status: 1, createdAt: -1 }); // For report filtering
expenseSchema.index({ category: 1, createdAt: -1 }); // For report filtering
expenseSchema.index({ createdAt: -1, _id: -1 }); // For cursor pagination

module.exports = mongoose.model('Expense', expenseSchema);
