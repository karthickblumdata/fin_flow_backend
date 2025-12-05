const User = require('../models/userModel');
const sendOtpEmail = require('../utils/sendOtpEmail');

// @desc    Send OTP
// @route   POST /api/otp/send
// @access  Public
exports.sendOtp = async (req, res) => {
  try {
    const { email } = req.body;

    console.log('\n📧 OTP Send Request:', {
      email: email || 'not provided',
      timestamp: new Date().toISOString()
    });

    if (!email) {
      console.log('❌ OTP Send Failed: Email missing');
      return res.status(400).json({
        success: false,
        message: 'Please provide email'
      });
    }

    const user = await User.findOne({ email });

    if (!user) {
      console.log(`❌ OTP Send Failed: User not found - ${email}`);
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    console.log('🔢 Generated OTP:', {
      email: user.email,
      otp: otp,
      otpExpiry: otpExpiry,
      expiresIn: '10 minutes'
    });

    user.otp = otp;
    user.otpExpiry = otpExpiry;
    await user.save({ validateBeforeSave: false });

    console.log('✅ OTP saved to database:', {
      email: user.email,
      otp: otp
    });

    try {
      await sendOtpEmail(email, otp, 'verification');
      console.log('✅ OTP email sent successfully to:', email);
      
      res.status(200).json({
        success: true,
        message: 'OTP sent to your email'
      });
    } catch (emailError) {
      console.error('❌ Failed to send OTP email:', {
        email: email,
        error: emailError.message
      });
      
      // Return error if email fails
      res.status(500).json({
        success: false,
        message: 'Failed to send OTP email. Please check email service configuration or contact support.'
      });
    }
  } catch (error) {
    console.error('❌ OTP Send Error:', {
      error: error.message,
      stack: error.stack,
      email: req.body?.email || 'unknown'
    });
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Verify OTP
// @route   POST /api/otp/verify
// @access  Public
exports.verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    console.log('\n🔐 OTP Verification Attempt:', {
      email: email || 'not provided',
      otp: otp ? '***' : 'not provided',
      timestamp: new Date().toISOString()
    });

    if (!email || !otp) {
      console.log('❌ OTP Verification Failed: Email or OTP missing');
      return res.status(400).json({
        success: false,
        message: 'Please provide email and OTP'
      });
    }

    const user = await User.findOne({ email }).select('+otp +otpExpiry');

    if (!user) {
      console.log(`❌ OTP Verification Failed: User not found - ${email}`);
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    console.log('📋 OTP Verification Details:', {
      email: user.email,
      hasOtp: !!user.otp,
      storedOtp: user.otp ? '***' : 'null',
      providedOtp: otp,
      otpExpiry: user.otpExpiry,
      currentTime: new Date(),
      isExpired: user.otpExpiry ? user.otpExpiry < new Date() : 'N/A'
    });

    // Convert both to strings for comparison to avoid type mismatch
    const storedOtp = String(user.otp || '');
    const providedOtp = String(otp || '');

    if (storedOtp !== providedOtp) {
      console.log(`❌ OTP Verification Failed: Invalid OTP - ${email}`);
      console.log(`   Stored OTP: ${storedOtp}`);
      console.log(`   Provided OTP: ${providedOtp}`);
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP'
      });
    }

    if (!user.otpExpiry || user.otpExpiry < new Date()) {
      console.log(`❌ OTP Verification Failed: OTP expired - ${email}`);
      console.log(`   OTP Expiry: ${user.otpExpiry}`);
      console.log(`   Current Time: ${new Date()}`);
      return res.status(400).json({
        success: false,
        message: 'OTP has expired'
      });
    }

    console.log(`✅ OTP Verified Successfully: ${email}\n`);

    res.status(200).json({
      success: true,
      message: 'OTP verified successfully'
    });
  } catch (error) {
    console.error('❌ OTP Verification Error:', {
      error: error.message,
      stack: error.stack,
      email: req.body?.email || 'unknown'
    });
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Set password after OTP verification
// @route   POST /api/otp/set-password
// @access  Public
exports.setPassword = async (req, res) => {
  try {
    const { email, otp, password } = req.body;

    console.log('\n🔑 ===== SET PASSWORD REQUEST =====');
    console.log('   Email:', email || 'not provided');
    console.log('   Has OTP:', !!otp);
    console.log('   Password Length:', password ? password.length : 0);
    console.log('   Timestamp:', new Date().toISOString());
    console.log('================================\n');

    if (!email || !otp || !password) {
      console.log('❌ Set Password Failed: Email, OTP, or password missing');
      return res.status(400).json({
        success: false,
        message: 'Please provide email, OTP, and password'
      });
    }

    // Validate password length
    if (password.length < 6) {
      console.log('❌ Set Password Failed: Password too short');
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    const user = await User.findOne({ email }).select('+otp +otpExpiry');

    if (!user) {
      console.log(`❌ Set Password Failed: User not found - ${email}`);
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Verify OTP first
    const storedOtp = String(user.otp || '');
    const providedOtp = String(otp || '');

    if (storedOtp !== providedOtp) {
      console.log(`❌ Set Password Failed: Invalid OTP - ${email}`);
      console.log(`   Stored OTP: ${storedOtp}`);
      console.log(`   Provided OTP: ${providedOtp}`);
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP'
      });
    }

    if (!user.otpExpiry || user.otpExpiry < new Date()) {
      console.log(`❌ Set Password Failed: OTP expired - ${email}`);
      return res.status(400).json({
        success: false,
        message: 'OTP has expired'
      });
    }

    // If user already verified, allow password update (for password reset scenarios)
    if (user.isVerified && user.password) {
      console.log(`⚠️  User already verified - updating password for - ${email}`);
    }

    console.log('📝 Setting password for user:', {
      email: user.email,
      name: user.name,
      role: user.role,
      wasVerified: user.isVerified
    });

    try {
      user.password = password;
      user.isVerified = true; // Auto-verify on password set
      user.otp = undefined;
      user.otpExpiry = undefined;
      await user.save();
    } catch (saveError) {
      console.error('❌ Set Password Failed: Error saving password', {
        error: saveError.message,
        validationErrors: saveError.errors
      });
      
      // Check if it's a validation error
      if (saveError.name === 'ValidationError') {
        const validationErrors = Object.values(saveError.errors).map(err => err.message);
        return res.status(400).json({
          success: false,
          message: validationErrors.join('. ') || 'Password validation failed'
        });
      }
      
      throw saveError; // Re-throw if not a validation error
    }

    console.log('\n✅ ===== PASSWORD SET SUCCESSFULLY =====');
    console.log('   Email:', email);
    console.log('   Name:', user.name);
    console.log('   Role:', user.role);
    console.log('   User Verified:', user.isVerified);
    console.log('   ✅ User can now login with email and password');
    console.log('==========================================\n');

    res.status(200).json({
      success: true,
      message: 'Password set successfully. You can now login.'
    });
  } catch (error) {
    console.error('❌ Set Password Error:', {
      error: error.message,
      stack: error.stack,
      email: req.body?.email || 'unknown'
    });
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
