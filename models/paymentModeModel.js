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
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('PaymentMode', paymentModeSchema);
