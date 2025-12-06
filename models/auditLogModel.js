const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  action: {
    type: String,
    required: true
  },
  actionType: {
    type: String,
    enum: ['Create', 'Update', 'Delete', 'Approve', 'Reject', 'Cancel', 'Flag', 'Restore', 'Send Invite'],
    required: true
  },
  entityType: {
    type: String,
    enum: ['User', 'Wallet', 'Transaction', 'Collection', 'Expense', 'PaymentMode', 'ExpenseType', 'CustomField'],
    required: true
  },
  entityId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  previousValue: {
    type: mongoose.Schema.Types.Mixed
  },
  newValue: {
    type: mongoose.Schema.Types.Mixed
  },
  ipAddress: {
    type: String
  },
  notes: {
    type: String
  }
}, {
  timestamps: true
});

auditLogSchema.index({ userId: 1, createdAt: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1 });
auditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
