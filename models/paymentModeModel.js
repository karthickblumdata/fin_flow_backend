const mongoose = require('mongoose');

const paymentModeSchema = new mongoose.Schema({
  modeName: {
    type: String,
    required: true,
    unique: true
  },
  description: {
    type: String
  },
  autoPay: {
    type: Boolean,
    default: false
  },
  assignedReceiver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  display: {
    type: [String],
    enum: ['Collection', 'Expenses', 'Transaction'],
    default: ['Collection']
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  // Wallet fields for Payment Mode
  cashBalance: {
    type: Number,
    default: 0.0
  },
  upiBalance: {
    type: Number,
    default: 0.0
  },
  bankBalance: {
    type: Number,
    default: 0.0
  },
  cashIn: {
    type: Number,
    default: 0.0
  },
  cashOut: {
    type: Number,
    default: 0.0
  }
}, {
  timestamps: true
});

// Virtual for totalBalance
paymentModeSchema.virtual('totalBalance').get(function() {
  return (this.cashBalance || 0) + (this.upiBalance || 0) + (this.bankBalance || 0);
});

// Ensure virtual fields are included in JSON output
paymentModeSchema.set('toJSON', { virtuals: true });
paymentModeSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('PaymentMode', paymentModeSchema);
