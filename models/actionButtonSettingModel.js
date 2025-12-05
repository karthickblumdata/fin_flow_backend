const mongoose = require('mongoose');

const BUTTON_KEYS = ['approve', 'reject', 'unapprove', 'delete', 'edit', 'flag'];

const actionButtonSettingSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      enum: BUTTON_KEYS,
      required: true,
      unique: true,
      trim: true
    },
    showButton: {
      type: Boolean,
      default: true
    },
    enablePopup: {
      type: Boolean,
      default: true
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  {
    timestamps: true
  }
);

module.exports = {
  ActionButtonSetting: mongoose.model('ActionButtonSetting', actionButtonSettingSchema),
  BUTTON_KEYS
};


