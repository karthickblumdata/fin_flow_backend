const mongoose = require('mongoose');

const expenseTypeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    unique: true
  },
  description: {
    type: String,
    trim: true,
    default: ''
  },
  isActive: {
    type: Boolean,
    default: true
  },
  imageUrl: {
    type: String,
    trim: true,
    default: ''
  },
  proofRequired: {
    type: Boolean,
    default: false
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

expenseTypeSchema.index({ name: 1 });
expenseTypeSchema.index({ isActive: 1 });

module.exports = mongoose.model('ExpenseType', expenseTypeSchema);

