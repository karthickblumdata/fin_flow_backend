const mongoose = require('mongoose');

const cashFlowSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['in', 'out'],
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  description: {
    type: String,
    trim: true,
    maxlength: 500
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
cashFlowSchema.index({ type: 1, createdAt: -1 });
cashFlowSchema.index({ createdAt: -1 });

module.exports = mongoose.model('CashFlow', cashFlowSchema);

