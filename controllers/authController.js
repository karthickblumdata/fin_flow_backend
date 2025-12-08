const bcrypt = require('bcryptjs');
const User = require('../models/userModel');
const Role = require('../models/roleModel');
const generateToken = require('../utils/generateToken');
const { sendOtpEmail, sendResetPasswordEmail } = require('../utils/sendOtpEmail');
const { createAuditLog } = require('../utils/auditLogger');

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    console.log('\n🔐 Login Attempt:', {
      email: email || 'not provided',
      timestamp: new Date().toISOString(),
      ip: req.ip || req.connection.remoteAddress
    });

    if (!email || !password) {
      console.log('❌ Login Failed: Email or password missing');
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password'
      });
    }

    // Normalize email to lowercase (schema stores emails in lowercase)
    const normalizedEmail = email.toLowerCase().trim();
    
    const user = await User.findOne({ email: normalizedEmail }).select('+password');

    if (!user) {
      console.log(`❌ Login Failed: User not found - ${normalizedEmail}`);
      console.log(`   Searched for: ${normalizedEmail}`);
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    console.log(`✅ User found: ${user.email}`);
    console.log(`   User ID: ${user._id}`);
    console.log(`   Name: ${user.name}`);
    console.log(`   Role: ${user.role}`);
    console.log(`   Is Verified: ${user.isVerified}`);
    console.log(`   Has Password: ${!!user.password}`);
    console.log(`   Password Hash Length: ${user.password ? user.password.length : 0}`);

    // Check if user has a password
    if (!user.password) {
      console.log(`❌ Login Failed: User has no password set - ${normalizedEmail}`);
      return res.status(401).json({
        success: false,
        message: 'User account not properly set up. Please contact administrator.'
      });
    }

    // Check password
    console.log(`🔐 Comparing password...`);
    const isMatch = await bcrypt.compare(password, user.password);
    console.log(`   Password Match: ${isMatch}`);

    if (!isMatch) {
      console.log(`❌ Login Failed: Invalid password - ${normalizedEmail}`);
      console.log(`   Provided password length: ${password.length}`);
      console.log(`   Stored password hash length: ${user.password.length}`);
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if user account is active (isVerified = true)
    // Only active users can login
    if (!user.isVerified) {
      console.log(`❌ Login Failed: User account is inactive - ${normalizedEmail}`);
      console.log(`   User Status: Inactive (isVerified: ${user.isVerified})`);
      return res.status(403).json({
        success: false,
        message: 'Your account is inactive. Please contact administrator to activate your account.'
      });
    }

    const token = generateToken(user._id);

    // Refresh user data from database to get latest permissions
    // This ensures we have the most up-to-date userSpecificPermissions
    const freshUser = await User.findById(user._id);
    if (!freshUser) {
      console.log(`❌ Login Failed: User not found after refresh - ${email}`);
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get user permissions (role + user-specific)
    // Super Admin always has access to everything - no permission checks needed
    let rolePermissions = [];
    let userSpecificPermissions = freshUser.userSpecificPermissions || [];
    let allPermissions = [];

    console.log(`\n📋 ===== LOADING USER PERMISSIONS FOR LOGIN =====`);
    console.log(`   User ID: ${freshUser._id}`);
    console.log(`   User Email: ${freshUser.email}`);
    console.log(`   User Role: ${freshUser.role}`);
    console.log(`   User-Specific Permissions Count: ${userSpecificPermissions.length}`);
    if (userSpecificPermissions.length > 0) {
      console.log(`   User-Specific Permissions:`, userSpecificPermissions);
    }

    if (freshUser.role === 'SuperAdmin') {
      // Super Admin has access to everything
      // Return special marker '*' to indicate all permissions (or empty array - frontend handles as "all access")
      allPermissions = ['*']; // Special marker indicating all permissions
      rolePermissions = ['*'];
      userSpecificPermissions = []; // Super Admin doesn't need user-specific permissions
      console.log(`   ✅ SuperAdmin - All permissions granted`);
    } else {
      // Normalize user-specific permissions first
      userSpecificPermissions = (userSpecificPermissions || [])
        .map(id => typeof id === 'string' ? id.trim() : String(id).trim())
        .filter(id => id.length > 0 && id !== 'root' && id.toLowerCase() !== 'root');
      
      // Get role-based permissions for non-Super Admin users
      const role = await Role.findOne({ roleName: freshUser.role });
      if (role && role.permissionIds && role.permissionIds.length > 0) {
        // Normalize permission IDs: trim, filter out empty strings and 'root'
        rolePermissions = role.permissionIds
          .map(id => typeof id === 'string' ? id.trim() : String(id).trim())
          .filter(id => id.length > 0 && id !== 'root' && id.toLowerCase() !== 'root');
        console.log(`   Role Permissions Count: ${rolePermissions.length}`);
        if (rolePermissions.length > 0) {
          console.log(`   Role Permissions Sample: ${rolePermissions.slice(0, 5).join(', ')}`);
        }
      } else {
        console.log(`   ⚠️  No role found or role has no permissions for role: ${freshUser.role}`);
      }
      
      // Combine role and user-specific permissions (deduplicate)
      // New users start with empty array - Super Admin must configure permissions
      allPermissions = [...new Set([...rolePermissions, ...userSpecificPermissions])];
      console.log(`   Combined Permissions Count: ${allPermissions.length}`);
      if (allPermissions.length > 0) {
        console.log(`   Combined Permissions:`, allPermissions);
      } else {
        console.log(`   ⚠️  WARNING: User has NO permissions assigned!`);
      }
    }
    console.log(`==========================================\n`);

    console.log(`✅ Login Successful: ${email} (${freshUser.role})`);
    console.log(`   User ID: ${freshUser._id}`);
    console.log(`   Name: ${freshUser.name}`);
    console.log(`   Permissions: ${allPermissions.length} total (${rolePermissions.length} role, ${userSpecificPermissions.length} user-specific)\n`);

    // Create audit log for login
    await createAuditLog(
      user._id,
      `User logged in: ${email}`,
      'Create',
      'User',
      user._id,
      null,
      { loginTime: new Date().toISOString() },
      req.ip || req.connection.remoteAddress,
      'User login'
    );

    // Log final response to verify permissions are included
    console.log(`\n📤 ===== LOGIN RESPONSE PREPARATION =====`);
    console.log(`   User Email: ${freshUser.email}`);
    console.log(`   User Role: ${freshUser.role}`);
    console.log(`   Permissions Array Type: ${Array.isArray(allPermissions) ? 'Array' : typeof allPermissions}`);
    console.log(`   Permissions Array Length: ${allPermissions.length}`);
    console.log(`   Permissions Array Content:`, JSON.stringify(allPermissions, null, 2));
    console.log(`   Response will include permissions: ${allPermissions.length > 0 ? 'YES' : 'NO'}`);
    console.log(`==========================================\n`);

    res.status(200).json({
      success: true,
      token,
      user: {
        _id: freshUser._id,
        name: freshUser.name,
        email: freshUser.email,
        role: freshUser.role,
        permissions: allPermissions, // This includes role + user-specific permissions combined
        isNonWalletUser: freshUser.isNonWalletUser || false  // Include non-wallet user flag
      }
    });
  } catch (error) {
    console.error('❌ Login Error:', {
      message: error.message,
      email: req.body?.email || 'unknown',
      stack: error.stack
    });
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Refresh current user permissions
// @route   GET /api/auth/me/permissions
// @access  Private
exports.refreshCurrentUserPermissions = async (req, res) => {
  try {
    const userId = req.user._id;
    
    // Refresh user data from database to get latest permissions
    const freshUser = await User.findById(userId);
    if (!freshUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get user permissions (role + user-specific)
    let rolePermissions = [];
    let userSpecificPermissions = freshUser.userSpecificPermissions || [];
    let allPermissions = [];

    console.log(`\n🔄 ===== REFRESHING USER PERMISSIONS =====`);
    console.log(`   User ID: ${freshUser._id}`);
    console.log(`   User Email: ${freshUser.email}`);
    console.log(`   User Role: ${freshUser.role}`);
    console.log(`   User-Specific Permissions Count: ${userSpecificPermissions.length}`);

    if (freshUser.role === 'SuperAdmin') {
      // Super Admin has access to everything
      allPermissions = ['*'];
      rolePermissions = ['*'];
      userSpecificPermissions = [];
      console.log(`   ✅ SuperAdmin - All permissions granted`);
    } else {
      // Normalize user-specific permissions first
      userSpecificPermissions = (userSpecificPermissions || [])
        .map(id => typeof id === 'string' ? id.trim() : String(id).trim())
        .filter(id => id.length > 0 && id !== 'root' && id.toLowerCase() !== 'root');
      
      // Get role-based permissions for non-Super Admin users
      const role = await Role.findOne({ roleName: freshUser.role });
      if (role && role.permissionIds && role.permissionIds.length > 0) {
        // Normalize permission IDs: trim, filter out empty strings and 'root'
        rolePermissions = role.permissionIds
          .map(id => typeof id === 'string' ? id.trim() : String(id).trim())
          .filter(id => id.length > 0 && id !== 'root' && id.toLowerCase() !== 'root');
        console.log(`   Role Permissions Count: ${rolePermissions.length}`);
        if (rolePermissions.length > 0) {
          console.log(`   Role Permissions Sample: ${rolePermissions.slice(0, 5).join(', ')}`);
        }
      } else {
        console.log(`   ⚠️  No role found or role has no permissions for role: ${freshUser.role}`);
      }
      
      // Combine role and user-specific permissions (deduplicate)
      allPermissions = [...new Set([...rolePermissions, ...userSpecificPermissions])];
      console.log(`   Combined Permissions Count: ${allPermissions.length}`);
      if (allPermissions.length > 0) {
        console.log(`   Combined Permissions Sample: ${allPermissions.slice(0, 5).join(', ')}`);
      } else {
        console.log(`   ⚠️  WARNING: User has NO permissions assigned!`);
      }
    }
    console.log(`==========================================\n`);

    res.status(200).json({
      success: true,
      permissions: allPermissions,
      role: freshUser.role
    });
  } catch (error) {
    console.error('❌ Error refreshing user permissions:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to refresh permissions'
    });
  }
};

// @desc    Forgot password - generate and send password based on name + date of birth
// @route   POST /api/auth/forgot-password
// @access  Public
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    console.log('\n🔑 Forgot Password Request:', {
      email: email || 'not provided',
      timestamp: new Date().toISOString()
    });

    if (!email) {
      console.log('❌ Forgot Password Failed: Email missing');
      return res.status(400).json({
        success: false,
        message: 'Please provide email'
      });
    }

    const user = await User.findOne({ email }).select('+password');

    if (!user) {
      console.log(`❌ Forgot Password Failed: User not found - ${email}`);
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if user has date of birth
    if (!user.dateOfBirth) {
      console.log(`❌ Forgot Password Failed: Date of birth not found for user - ${email}`);
      return res.status(400).json({
        success: false,
        message: 'Date of birth is required to reset password. Please contact administrator.'
      });
    }

    // Generate password from name + date of birth (date only)
    // Format: name + DDMMYYYY (e.g., "John25031990")
    const namePart = user.name.replace(/\s+/g, ''); // Remove spaces from name
    const dob = new Date(user.dateOfBirth);
    const day = String(dob.getDate()).padStart(2, '0');
    const month = String(dob.getMonth() + 1).padStart(2, '0');
    const year = dob.getFullYear();
    const dobPart = `${day}${month}${year}`;
    const newPassword = `${namePart}${dobPart}`;

    console.log('🔑 Generated Password from Name + DOB:', {
      email: user.email,
      name: user.name,
      dateOfBirth: user.dateOfBirth,
      generatedPassword: newPassword
    });

    // Update user password (will be hashed by pre-save hook)
    user.password = newPassword;
    await user.save();

    console.log('✅ Password updated in database');

    // Try to send email with password
    try {
      await sendResetPasswordEmail(email, newPassword, user.name, user.dateOfBirth);
      console.log(`✅ Password sent successfully to: ${email}\n`);
      
      res.status(200).json({
        success: true,
        message: 'Password has been reset and sent to your email'
      });
    } catch (emailError) {
      console.error('❌ Failed to send password email:', {
        email: email,
        error: emailError.message
      });
      
      // If email sending fails, return error
      console.error('⚠️ Email service not configured or failed. Password not sent.');
      
      // Provide more specific error message based on error type
      let errorMessage = 'Failed to send password email. Please check email service configuration or contact support.';
      if (emailError.message.includes('App Password') || emailError.message.includes('authentication failed')) {
        errorMessage = 'Gmail authentication failed. Please configure Gmail App Password in your .env file. Check server logs for instructions.';
      }
      
      res.status(500).json({
        success: false,
        message: errorMessage
      });
    }
  } catch (error) {
    console.error('❌ Forgot Password Error:', {
      error: error.message,
      email: req.body?.email || 'unknown',
      stack: error.stack
    });
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Reset password
// @route   POST /api/auth/reset-password
// @access  Public
exports.resetPassword = async (req, res) => {
  try {
    const { email, token, newPassword } = req.body;

    console.log('\n🔑 Password Reset Request:', {
      email: email || 'not provided',
      hasToken: !!token,
      hasPassword: !!newPassword,
      timestamp: new Date().toISOString()
    });

    if (!email || !token || !newPassword) {
      console.log('❌ Password Reset Failed: Missing required fields');
      return res.status(400).json({
        success: false,
        message: 'Please provide email, reset token, and new password'
      });
    }

    // Validate password length
    if (newPassword.length < 6) {
      console.log('❌ Password Reset Failed: Password too short');
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    const user = await User.findOne({ email }).select('+otp +otpExpiry');

    if (!user) {
      console.log(`❌ Password Reset Failed: User not found - ${email}`);
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const storedToken = String(user.otp || '');
    const providedToken = String(token || '');

    if (storedToken !== providedToken) {
      console.log(`❌ Password Reset Failed: Invalid reset token - ${email}`);
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset link'
      });
    }

    if (user.otpExpiry < new Date()) {
      console.log(`❌ Password Reset Failed: Reset token expired - ${email}`);
      return res.status(400).json({
        success: false,
        message: 'Reset link has expired. Please request a new one.'
      });
    }

    try {
      user.password = newPassword;
      user.otp = undefined;
      user.otpExpiry = undefined;
      await user.save();
    } catch (saveError) {
      console.error('❌ Password Reset Failed: Error saving password', {
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

    console.log(`✅ Password Reset Successful: ${email}\n`);

    res.status(200).json({
      success: true,
      message: 'Password reset successfully'
    });
  } catch (error) {
    console.error('❌ Password Reset Error:', {
      error: error.message,
      email: req.body?.email || 'unknown',
      stack: error.stack
    });
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Logout user (token invalidation)
// @route   POST /api/auth/logout
// @access  Public (client-side token removal)
exports.logout = async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const userId = req.user?._id || 'unknown';
    const userEmail = req.user?.email || 'unknown';

    console.log('\n🚪 ===== LOGOUT REQUEST =====');
    console.log('   User ID:', userId);
    console.log('   User Email:', userEmail);
    console.log('   Has Token:', !!token);
    console.log('   Timestamp:', new Date().toISOString());
    console.log('   IP:', req.ip || req.connection.remoteAddress);
    console.log('============================\n');

    // Note: JWT tokens are stateless, so we can't invalidate them server-side
    // The client should remove the token from storage
    // In a production system, you might want to maintain a token blacklist

    console.log(`✅ Logout Successful: ${userEmail}`);
    console.log('   ⚠️  Note: Client should remove token from storage\n');

    // Create audit log for logout (only if user is authenticated)
    if (req.user && req.user._id) {
      await createAuditLog(
        req.user._id,
        `User logged out: ${userEmail}`,
        'Update',
        'User',
        req.user._id,
        { loginTime: new Date().toISOString() },
        { logoutTime: new Date().toISOString() },
        req.ip || req.connection.remoteAddress,
        'User logout'
      );
    }

    res.status(200).json({
      success: true,
      message: 'Logout successful. Please remove token from client storage.'
    });
  } catch (error) {
    console.error('❌ Logout Error:', {
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
