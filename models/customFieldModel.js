const mongoose = require('mongoose');

const customFieldSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    unique: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  useInCollections: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

customFieldSchema.index({ name: 1 });
customFieldSchema.index({ isActive: 1 });

module.exports = mongoose.model('CustomField', customFieldSchema);

