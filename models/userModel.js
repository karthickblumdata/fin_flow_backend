const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide a name'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Please provide an email'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email']
  },
  phoneNumber: {
    type: String,
    trim: true
  },
  countryCode: {
    type: String,
    trim: true,
    default: '+91'
  },
  dateOfBirth: {
    type: Date,
    required: false
  },
  profileImage: {
    type: String,
    trim: true
  },
  password: {
    type: String,
    required: function() {
      return this.isVerified === true;
    },
    minlength: 6,
    select: false
  },
  role: {
    type: String,
    required: true,
    trim: true
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  otp: {
    type: String,
    select: false
  },
  otpExpiry: {
    type: Date,
    select: false
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  userSpecificPermissions: [{
    type: String,
    trim: true
  }],
  isNonWalletUser: {
    type: Boolean,
    default: false  // Default: false (normal user with wallet)
  }
}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password') || !this.password) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

module.exports = mongoose.model('User', userSchema);
