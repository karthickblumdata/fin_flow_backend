const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  cashBalance: {
    type: Number,
    default: 0,
    min: 0
  },
  upiBalance: {
    type: Number,
    default: 0,
    min: 0
  },
  bankBalance: {
    type: Number,
    default: 0,
    min: 0
  },
  cashIn: {
    type: Number,
    default: 0,
    min: 0
  },
  cashOut: {
    type: Number,
    default: 0,
    min: 0
  }
}, {
  timestamps: true
});

walletSchema.virtual('totalBalance').get(function() {
  return this.cashBalance + this.upiBalance + this.bankBalance;
});

walletSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Wallet', walletSchema);
