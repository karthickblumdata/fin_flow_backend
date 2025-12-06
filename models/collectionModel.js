const mongoose = require('mongoose');

const collectionSchema = new mongoose.Schema({
  voucherNumber: {
    type: String,
    unique: true,
    required: true
  },
  collectedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: function() {
      // Allow null for system collections (isSystemCollection = true)
      return !this.isSystemCollection;
    }
  },
  from: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  customerName: {
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
  paymentModeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PaymentMode'
  },
  assignedReceiver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  status: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected', 'Flagged'],
    default: 'Pending'
  },
  proofUrl: {
    type: String
  },
  notes: {
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
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedAt: {
    type: Date
  },
  systemTransactionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction'
  },
  collectionType: {
    type: String,
    enum: ['collection', 'systematic'],
    default: 'collection'
  },
  isSystematicEntry: {
    type: Boolean,
    default: false
  },
  parentCollectionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Collection'
  },
  isSystemCollection: {
    type: Boolean,
    default: false
  },
  customFields: {
    type: Map,
    of: String,
    default: {}
  }
}, {
  timestamps: true
});

collectionSchema.index({ collectedBy: 1, createdAt: -1 });
collectionSchema.index({ assignedReceiver: 1, status: 1 });
collectionSchema.index({ status: 1 });
collectionSchema.index({ mode: 1 });
collectionSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Collection', collectionSchema);
