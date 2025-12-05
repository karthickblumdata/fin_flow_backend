const mongoose = require('mongoose');

const permissionSchema = new mongoose.Schema({
  permissionId: {
    type: String,
    required: [true, 'Please provide a permission ID'],
    unique: true,
    trim: true,
    lowercase: true
  },
  label: {
    type: String,
    required: [true, 'Please provide a permission label'],
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  category: {
    type: String,
    required: [true, 'Please provide a permission category'],
    trim: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Index for faster queries
permissionSchema.index({ permissionId: 1 });
permissionSchema.index({ category: 1 });

module.exports = mongoose.model('Permission', permissionSchema);

