const mongoose = require('mongoose');

const roleSchema = new mongoose.Schema({
  roleName: {
    type: String,
    required: [true, 'Please provide a role name'],
    unique: true,
    trim: true,
    uppercase: false
  },
  name: {
    type: String,
    trim: true
  },
  permissionIds: [{
    type: String,
    required: true
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Index for faster queries
roleSchema.index({ roleName: 1 });

module.exports = mongoose.model('Role', roleSchema);

