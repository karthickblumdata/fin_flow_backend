const User = require('../models/userModel');
const Role = require('../models/roleModel');
const sendOtpEmail = require('../utils/sendOtpEmail');
const { sendInviteEmail } = require('../utils/sendOtpEmail');
const { createAuditLog } = require('../utils/auditLogger');
const { notifyAmountUpdate, emitDashboardStats } = require('../utils/amountUpdateHelper');
const { getOrCreateWallet } = require('../utils/walletHelper');

// Helper function to generate random password
const generatePassword = (length = 12) => {
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  let password = '';
  // Ensure at least one lowercase, one uppercase, one number, and one special character
  password += 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)];
  password += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(Math.random() * 26)];
  password += '0123456789'[Math.floor(Math.random() * 10)];
  password += '!@#$%^&*'[Math.floor(Math.random() * 8)];
  // Fill the rest randomly
  for (let i = password.length; i < length; i++) {
    password += charset[Math.floor(Math.random() * charset.length)];
  }
  // Shuffle the password
  return password.split('').sort(() => Math.random() - 0.5).join('');
};

// @desc    Create new user
// @route   POST /api/users/create
// @access  Private (SuperAdmin only)
exports.createUser = async (req, res) => {
  try {
    console.log('\n👤 ===== CREATE USER REQUEST =====');
    console.log('   Timestamp:', new Date().toISOString());
    console.log('   IP:', req.ip || req.connection.remoteAddress);
    console.log('   Request Body:', {
      name: req.body?.name || 'not provided',
      email: req.body?.email || 'not provided',
      role: req.body?.role || 'not provided',
      phoneNumber: req.body?.phoneNumber || 'not provided',
      countryCode: req.body?.countryCode || 'not provided',
      dateOfBirth: req.body?.dateOfBirth || 'not provided',
      profileImage: req.body?.profileImage ? 'provided' : 'not provided',
      hasPermissions: !!req.body?.userSpecificPermissions,
      permissionsCount: Array.isArray(req.body?.userSpecificPermissions) 
        ? req.body.userSpecificPermissions.length 
        : 0
    });
    console.log('   Created By:', req.user?.email || 'unknown');
    console.log('   Creator Role:', req.user?.role || 'unknown');
    console.log('===============================\n');

    const { name, email, role, userSpecificPermissions, phoneNumber, countryCode, dateOfBirth, profileImage, skipWallet } = req.body;

    if (!name || !email || !role) {
      console.log('❌ Validation Failed: Missing required fields');
      console.log('   Provided:', { name: !!name, email: !!email, role: !!role });
      return res.status(400).json({
        success: false,
        message: 'Please provide name, email, and role'
      });
    }

    // Validate dateOfBirth is required for new user creation
    if (!dateOfBirth) {
      console.log('❌ Validation Failed: Date of birth is required');
      return res.status(400).json({
        success: false,
        message: 'Date of birth is required for new user creation'
      });
    }

    // Validate and parse dateOfBirth
    let parsedDateOfBirth;
    try {
      parsedDateOfBirth = new Date(dateOfBirth);
      if (isNaN(parsedDateOfBirth.getTime())) {
        throw new Error('Invalid date format');
      }
    } catch (error) {
      console.log('❌ Validation Failed: Invalid date of birth format');
      return res.status(400).json({
        success: false,
        message: 'Invalid date of birth format. Please provide a valid date.'
      });
    }

    // Validate userSpecificPermissions if provided
    if (userSpecificPermissions !== undefined) {
      if (!Array.isArray(userSpecificPermissions)) {
        console.log('❌ Validation Failed: userSpecificPermissions must be an array');
        return res.status(400).json({
          success: false,
          message: 'userSpecificPermissions must be an array'
        });
      }
      // Trim and filter empty permission IDs
      const validPermissions = userSpecificPermissions
        .map(id => typeof id === 'string' ? id.trim() : String(id).trim())
        .filter(id => id && id.length > 0);
      
      console.log(`✅ Validated ${validPermissions.length} permissions`);
      if (validPermissions.length !== userSpecificPermissions.length) {
        console.log(`   ⚠️  Filtered out ${userSpecificPermissions.length - validPermissions.length} invalid/empty permissions`);
      }
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      console.log('❌ User Creation Failed: User already exists');
      console.log('   Email:', email);
      console.log('   Existing User ID:', existingUser._id);
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Prevent creating SuperAdmin users (only one SuperAdmin exists)
    if (role === 'SuperAdmin') {
      console.log('❌ User Creation Failed: Cannot create SuperAdmin');
      console.log('   Attempted role:', role);
      return res.status(403).json({
        success: false,
        message: 'Cannot create SuperAdmin users. SuperAdmin is fixed and only one exists.'
      });
    }

    // Generate password using name + year from dateOfBirth
    const nameLower = name.toLowerCase().replace(/\s+/g, ''); // Remove spaces and convert to lowercase
    const year = parsedDateOfBirth.getFullYear();
    const generatedPassword = `${nameLower}${year}`; // e.g., "karthick2001"

    console.log('\n🔑 ===== PASSWORD GENERATION =====');
    console.log('   Name:', name);
    console.log('   Name (lowercase, no spaces):', nameLower);
    console.log('   Date of Birth:', dateOfBirth);
    console.log('   Year from Date of Birth:', year);
    console.log('   Generated Password:', generatedPassword);
    console.log('   Password Type: Name + Year Format');
    console.log('=============================\n');

    console.log('\n👤 Creating new user:', {
      name,
      email,
      role,
      createdBy: req.user.email,
      timestamp: new Date().toISOString()
    });

    // Normalize email to lowercase
    const normalizedEmail = email.toLowerCase().trim();

    // Process permissions
    let finalPermissions = [];
    if (userSpecificPermissions !== undefined && Array.isArray(userSpecificPermissions)) {
      // Trim and filter empty permission IDs
      finalPermissions = userSpecificPermissions
        .map(id => typeof id === 'string' ? id.trim() : String(id).trim())
        .filter(id => id && id.length > 0);
      
      console.log(`✅ Processing ${finalPermissions.length} permissions for new user`);
      if (finalPermissions.length > 0) {
        console.log('   Permissions:', finalPermissions);
      }
    } else {
      console.log('ℹ️  No permissions provided - user will have empty permissions array');
    }

    // Create user with password and mark as verified
    // Initialize userSpecificPermissions from request or empty array
    const userData = {
      name,
      email: normalizedEmail,
      role,
      password: generatedPassword, // Password will be hashed by pre-save hook
      isVerified: true, // Mark as verified since we're sending credentials
      createdBy: req.user._id,
      userSpecificPermissions: finalPermissions, // Use provided permissions or empty array
      isNonWalletUser: skipWallet ? true : false  // Set flag based on skipWallet
    };

    // Add phone number if provided
    if (phoneNumber && phoneNumber.trim() !== '') {
      userData.phoneNumber = phoneNumber.trim();
    }
    
    // Add country code if provided
    if (countryCode && countryCode.trim() !== '') {
      userData.countryCode = countryCode.trim();
    }

    // Add date of birth (required for new users)
    userData.dateOfBirth = parsedDateOfBirth;

    // Add profile image if provided
    if (profileImage && profileImage.trim() !== '') {
      userData.profileImage = profileImage.trim();
    }

    const user = await User.create(userData);

    // Auto-create wallet for new user (unless skipWallet is true)
    if (!skipWallet) {
      try {
        await getOrCreateWallet(user._id);
        console.log('✅ Wallet created automatically for new user:', user.email);
      } catch (walletError) {
        console.error('⚠️  Warning: Failed to create wallet for new user:', walletError.message);
        // Don't fail user creation if wallet creation fails - it will be created on first access
      }
    } else {
      console.log('ℹ️  Wallet creation skipped for new user:', user.email);
    }

    // Verify password was hashed (should be ~60 characters for bcrypt)
    const userWithPassword = await User.findById(user._id).select('+password');
    const passwordHashLength = userWithPassword.password ? userWithPassword.password.length : 0;
    const isPasswordHashed = passwordHashLength > 50; // bcrypt hashes are typically 60 chars

    // Verify permissions were saved
    const savedUser = await User.findById(user._id);
    const savedPermissions = savedUser?.userSpecificPermissions || [];
    
    console.log('\n🔍 ===== PERMISSION SAVE VERIFICATION =====');
    console.log('   User ID:', user._id);
    console.log('   User Email:', user.email);
    console.log('   Permissions Sent in Request:', finalPermissions);
    console.log('   Permissions Sent Count:', finalPermissions.length);
    console.log('   Permissions Saved to DB:', savedPermissions);
    console.log('   Permissions Saved Count:', savedPermissions.length);
    console.log('   Permissions Type:', Array.isArray(savedPermissions) ? 'Array' : typeof savedPermissions);
    console.log('   Save Verification:', JSON.stringify(finalPermissions.sort()) === JSON.stringify(savedPermissions.sort()) ? '✅ MATCH' : '❌ MISMATCH');
    if (JSON.stringify(finalPermissions.sort()) !== JSON.stringify(savedPermissions.sort())) {
      console.log('   ⚠️  WARNING: Permissions mismatch detected!');
      console.log('   Expected:', finalPermissions);
      console.log('   Actual:', savedPermissions);
    }
    console.log('==========================================\n');
    
    console.log(`✅ User created with ${savedPermissions.length} permissions saved to database`);
    if (savedPermissions.length > 0) {
      console.log('   Saved permissions:', savedPermissions);
    } else {
      console.log('   ⚠️  WARNING: User created with NO permissions!');
    }

    console.log('✅ User created successfully:', {
      userId: user._id,
      email: user.email,
      isVerified: user.isVerified,
      hasPassword: !!userWithPassword.password,
      passwordHashLength: passwordHashLength,
      isPasswordHashed: isPasswordHashed,
      permissionsCount: savedPermissions.length,
      permissions: savedPermissions.length > 0 ? savedPermissions : 'None'
    });

    if (!isPasswordHashed) {
      console.error('⚠️  WARNING: Password may not have been hashed correctly!');
      console.error('   Password hash length:', passwordHashLength);
      console.error('   Expected: ~60 characters');
    }

    // Send registration email with username and password
    try {
      console.log('\n📧 ===== SENDING REGISTRATION EMAIL =====');
      console.log('   FROM (Admin/Creator):', req.user.email);
      console.log('   TO (New User):', email);
      console.log('   New User Name:', name);
      console.log('   Username (Email):', email);
      console.log('   Generated Password:', generatedPassword);
      console.log('================================\n');
      
      await sendInviteEmail(email, name, generatedPassword);
      
      console.log('\n✅ ===== REGISTRATION EMAIL SENT SUCCESSFULLY! =====');
      console.log('   ✅ Status: SENT');
      console.log('   📧 Recipient Email:', email);
      console.log('   👤 Recipient Name:', name);
      console.log('   🔑 Password Sent: Yes');
      console.log('   ⚠️  If email not received, check:');
      console.log('      - Spam/Junk folder');
      console.log('      - Email address is correct:', email);
      console.log('      - Email delivery may take 1-2 minutes');
      console.log('==========================================\n');
      
      res.status(201).json({
        success: true,
        message: 'User created successfully. Login credentials sent to email.',
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          isVerified: user.isVerified,
          userSpecificPermissions: user.userSpecificPermissions || []
        }
      });
    } catch (emailError) {
      console.error('\n❌ ===== FAILED TO SEND REGISTRATION EMAIL =====');
      console.error('   ❌ Status: FAILED');
      console.error('   📧 Recipient Email:', email);
      console.error('   👤 Recipient Name:', name);
      console.error('   Error Details:', {
        message: emailError.message,
        code: emailError.code,
        response: emailError.response,
        responseCode: emailError.responseCode
      });
      console.error('   Stack:', emailError.stack);
      console.error('   ⚠️  User created but registration email failed.');
      console.error('   ⚠️  Generated Password:', generatedPassword);
      console.error('   ⚠️  Please manually share credentials with the user.');
      console.error('==========================================\n');
      
      // Return error response if email fails, but include password in response for manual sharing
      res.status(500).json({
        success: false,
        message: 'User created but failed to send registration email. Please manually share credentials.',
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          isVerified: user.isVerified,
          userSpecificPermissions: user.userSpecificPermissions || []
        },
        // Include password in response only if email fails (for manual sharing)
        credentials: {
          username: email,
          password: generatedPassword
        }
      });
      return; // Don't continue with audit log if email failed
    }

    await createAuditLog(
      req.user._id,
      `Created user: ${email}`,
      'Create',
      'User',
      user._id,
      null,
      { name, email, role },
      req.ip,
      `Created by ${req.user.role}`
    );

    console.log('\n✅ ===== USER CREATION SUCCESSFUL =====');
    console.log('   User ID:', user._id);
    console.log('   Name:', user.name);
    console.log('   Email:', user.email);
    console.log('   Role:', user.role);
    console.log('   Created By:', req.user.email);
    console.log('   OTP Sent:', 'Yes');
    console.log('=====================================\n');
    
    // Response already sent in the email try block above

    // Emit real-time update if SuperAdmin created user
    if (req.user.role === 'SuperAdmin') {
      await notifyAmountUpdate('user_created', {
        userId: user._id,
        userName: user.name,
        userEmail: user.email,
        userRole: user.role,
        createdBy: req.user._id,
        isVerified: user.isVerified,
        createdAt: user.createdAt || new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('❌ Error creating user:', {
      error: error.message,
      stack: error.stack,
      body: req.body
    });
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get all users
// @route   GET /api/users
// @access  Private (SuperAdmin only)
exports.getUsers = async (req, res) => {
  try {
    // Get all users including admin@examples.com - no filtering
    // Use lean() to get plain JavaScript objects (ensures all fields are serialized)
    const users = await User.find()
      .select('-password -otp -otpExpiry')
      .lean()
      .sort({ createdAt: -1 });

    console.log(`✅ Found ${users.length} users in database`);

    // Check for users without roles and fix them
    const usersToUpdate = [];
    for (const user of users) {
      if (!user.role || user.role.trim() === '') {
        console.log(`⚠️  User ${user.email} has no role, assigning 'Staff' as default`);
        // For lean documents, we need to update in database separately
        usersToUpdate.push(
          User.findByIdAndUpdate(user._id, { role: 'Staff' }, { new: true }).catch(err => {
            console.error(`Failed to update role for user ${user.email}:`, err);
          })
        );
        // Update the local copy
        user.role = 'Staff';
      }
    }

    // Wait for all updates to complete (but don't block response)
    if (usersToUpdate.length > 0) {
      Promise.all(usersToUpdate).then(() => {
        console.log(`✅ Updated ${usersToUpdate.length} users with default role`);
      }).catch(err => {
        console.error('Error updating user roles:', err);
      });
    }

    // Check if admin@examples.com is in the list
    const adminUser = users.find(u => u.email === 'admin@examples.com');
    if (adminUser) {
      console.log(`✅ Found admin@examples.com: role=${adminUser.role}, isVerified=${adminUser.isVerified}, profileImage=${adminUser.profileImage ? 'present' : 'missing'}`);
    } else {
      console.log(`⚠️  admin@examples.com not found in database`);
    }

    // Log profileImage status for debugging
    const usersWithProfileImage = users.filter(u => u.profileImage && u.profileImage.trim() !== '').length;
    console.log(`📸 Users with profileImage: ${usersWithProfileImage} out of ${users.length}`);

    // Log isNonWalletUser status for debugging
    const nonWalletUsers = users.filter(u => u.isNonWalletUser === true).length;
    console.log(`👤 Users with isNonWalletUser=true: ${nonWalletUsers} out of ${users.length}`);
    
    // Debug: Log sample user to verify isNonWalletUser is included
    if (users.length > 0) {
      const sampleUser = users[0];
      console.log(`📋 Sample user data check - Email: ${sampleUser.email}, isNonWalletUser: ${sampleUser.isNonWalletUser} (type: ${typeof sampleUser.isNonWalletUser})`);
    }

    res.status(200).json({
      success: true,
      count: users.length,
      users
    });
  } catch (error) {
    console.error('❌ Error getting users:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Update user
// @route   PUT /api/users/:id
// @access  Private (SuperAdmin only)
exports.updateUser = async (req, res) => {
  try {
    const { name, email, role, dateOfBirth, profileImage, phoneNumber, countryCode, isVerified, isNonWalletUser } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Prevent modifying admin@examples.com user (protected user)
    if (user.email === 'admin@examples.com') {
      return res.status(403).json({
        success: false,
        message: 'Cannot modify admin@examples.com user. This user is protected.'
      });
    }

    // Prevent updating to SuperAdmin role (only one SuperAdmin exists)
    if (role && role === 'SuperAdmin') {
      return res.status(403).json({
        success: false,
        message: 'Cannot update user to SuperAdmin role. SuperAdmin is fixed and only one exists.'
      });
    }

    const oldData = {
      name: user.name,
      email: user.email,
      role: user.role,
      dateOfBirth: user.dateOfBirth,
      profileImage: user.profileImage,
      phoneNumber: user.phoneNumber,
      countryCode: user.countryCode,
      isVerified: user.isVerified
    };

    if (name) user.name = name;
    if (email) {
      const existingUser = await User.findOne({ email });
      if (existingUser && existingUser._id.toString() !== user._id.toString()) {
        return res.status(400).json({
          success: false,
          message: 'Email already in use'
        });
      }
      user.email = email;
    }
    if (role) user.role = role;
    
    // Update dateOfBirth if provided (optional for updates)
    if (dateOfBirth !== undefined) {
      if (dateOfBirth === null || dateOfBirth === '') {
        user.dateOfBirth = undefined;
      } else {
        try {
          const parsedDate = new Date(dateOfBirth);
          if (!isNaN(parsedDate.getTime())) {
            user.dateOfBirth = parsedDate;
          }
        } catch (error) {
          // Invalid date format, skip update
          console.log('⚠️  Invalid dateOfBirth format in update, skipping:', dateOfBirth);
        }
      }
    }
    
    // Update profileImage if provided (optional)
    if (profileImage !== undefined) {
      user.profileImage = profileImage && profileImage.trim() !== '' ? profileImage.trim() : undefined;
    }
    
    // Update phoneNumber if provided
    if (phoneNumber !== undefined) {
      user.phoneNumber = phoneNumber && phoneNumber.trim() !== '' ? phoneNumber.trim() : undefined;
    }
    
    // Update countryCode if provided
    if (countryCode !== undefined) {
      user.countryCode = countryCode && countryCode.trim() !== '' ? countryCode.trim() : undefined;
    }
    
    // Update isVerified (account status) if provided
    if (isVerified !== undefined) {
      user.isVerified = isVerified === true || isVerified === 'true' || isVerified === 1;
    }

    // Update isNonWalletUser if provided
    if (isNonWalletUser !== undefined) {
      user.isNonWalletUser = isNonWalletUser === true || isNonWalletUser === 'true' || isNonWalletUser === 1;
    }

    await user.save();

    await createAuditLog(
      req.user._id,
      `Updated user: ${user.email}`,
      'Update',
      'User',
      user._id,
      oldData,
      { 
        name: user.name, 
        email: user.email, 
        role: user.role,
        dateOfBirth: user.dateOfBirth,
        profileImage: user.profileImage,
        phoneNumber: user.phoneNumber,
        countryCode: user.countryCode,
        isVerified: user.isVerified
      },
      req.ip
    );

    // Emit real-time update if SuperAdmin updated user
    if (req.user.role === 'SuperAdmin') {
      await notifyAmountUpdate('user_updated', {
        userId: user._id,
        userName: user.name,
        userEmail: user.email,
        userRole: user.role,
        oldData,
        newData: { name: user.name, email: user.email, role: user.role },
        updatedBy: req.user._id
      });
    }

    res.status(200).json({
      success: true,
      message: 'User updated successfully',
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isVerified: user.isVerified,
        isNonWalletUser: user.isNonWalletUser,
        dateOfBirth: user.dateOfBirth,
        profileImage: user.profileImage,
        phoneNumber: user.phoneNumber,
        countryCode: user.countryCode
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Delete user
// @route   DELETE /api/users/:id
// @access  Private (SuperAdmin only)
exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Prevent deleting admin@examples.com user (protected user)
    if (user.email === 'admin@examples.com') {
      return res.status(403).json({
        success: false,
        message: 'Cannot delete admin@examples.com user. This user is protected.'
      });
    }

    // Prevent deleting yourself
    if (user._id.toString() === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete your own account'
      });
    }

    const userData = {
      userId: user._id,
      userName: user.name,
      userEmail: user.email,
      userRole: user.role
    };

    await User.findByIdAndDelete(user._id);

    await createAuditLog(
      req.user._id,
      `Deleted user: ${user.email}`,
      'Delete',
      'User',
      user._id,
      userData,
      null,
      req.ip
    );

    // Emit real-time update if SuperAdmin deleted user
    if (req.user.role === 'SuperAdmin') {
      await notifyAmountUpdate('user_deleted', {
        ...userData,
        deletedBy: req.user._id
      });
      
      // Update dashboard stats
      await emitDashboardStats();
    }

    res.status(200).json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Send invite email with username and password
// @route   POST /api/users/send-invite
// @access  Private (SuperAdmin only)
exports.sendInvite = async (req, res) => {
  try {
    console.log('\n📧 ===== SEND INVITE REQUEST =====');
    console.log('   Timestamp:', new Date().toISOString());
    console.log('   Request Body:', req.body);
    console.log('   Sent By:', req.user?.email || 'unknown');
    console.log('   Sender Role:', req.user?.role || 'unknown');
    console.log('===================================\n');

    const { userId, email } = req.body;

    if (!userId && !email) {
      console.log('❌ Send Invite Failed: Missing userId or email');
      return res.status(400).json({
        success: false,
        message: 'Please provide userId or email'
      });
    }

    // Find user by userId or email
    let user;
    if (userId) {
      user = await User.findById(userId);
    } else {
      user = await User.findOne({ email: email.toLowerCase() });
    }

    if (!user) {
      console.log('❌ Send Invite Failed: User not found');
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Generate password using name + year from dateOfBirth (if available)
    let passwordToSend;
    if (user.dateOfBirth) {
      const nameLower = user.name.toLowerCase().replace(/\s+/g, ''); // Remove spaces and convert to lowercase
      const year = new Date(user.dateOfBirth).getFullYear();
      passwordToSend = `${nameLower}${year}`; // e.g., "karthick2001"
      
      console.log('\n🔑 ===== PASSWORD GENERATION (Name + Year) =====');
      console.log('   Name:', user.name);
      console.log('   Name (lowercase, no spaces):', nameLower);
      console.log('   Date of Birth:', user.dateOfBirth);
      console.log('   Year from Date of Birth:', year);
      console.log('   Generated Password:', passwordToSend);
      console.log('   Password Type: Name + Year Format');
      console.log('==========================================\n');
    } else {
      // Fallback to random password if dateOfBirth is not available
      passwordToSend = generatePassword(10);
      console.log('\n🔑 ===== PASSWORD GENERATION (Random - No DOB) =====');
      console.log('   Generated Password Length:', passwordToSend.length);
      console.log('   Password Type: Random Secure Password (dateOfBirth not available)');
      console.log('==================================================\n');
    }

    // Save hashed password to user account
    // Note: The password will be hashed by the pre-save hook
    user.password = passwordToSend;
    user.isVerified = true; // Mark user as verified since they have a password
    await user.save();

    console.log('✅ Password saved to user account (hashed)');

    // Send invite email
    try {
      await sendInviteEmail(user.email, user.name, passwordToSend);
      
      console.log('\n✅ ===== INVITE EMAIL SENT SUCCESSFULLY! =====');
      console.log('   ✅ Status: SENT');
      console.log('   📧 Recipient Email:', user.email);
      console.log('   👤 Recipient Name:', user.name);
      console.log('   ⚠️  If email not received, check:');
      console.log('      - Spam/Junk folder');
      console.log('      - Email address is correct:', user.email);
      console.log('      - Email delivery may take 1-2 minutes');
      console.log('==============================================\n');

      // Create audit log
      await createAuditLog(
        req.user._id,
        `Sent invite email to: ${user.email}`,
        'Send Invite',
        'User',
        user._id,
        null,
        { email: user.email, name: user.name },
        req.ip,
        `Invite sent by ${req.user.role}`
      );

      res.status(200).json({
        success: true,
        message: 'Invite email sent successfully with username and password',
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          isVerified: user.isVerified
        }
      });
    } catch (emailError) {
      console.error('\n❌ ===== FAILED TO SEND INVITE EMAIL =====');
      console.error('   ❌ Status: FAILED');
      console.error('   📧 Recipient Email:', user.email);
      console.error('   👤 Recipient Name:', user.name);
      console.error('   Error Details:', {
        message: emailError.message,
        code: emailError.code,
        response: emailError.response,
        responseCode: emailError.responseCode
      });
      console.error('   Stack:', emailError.stack);
      console.error('==========================================\n');

      // Return error response if email fails
      res.status(500).json({
        success: false,
        message: 'Failed to send invite email. Please check email service configuration or try again.',
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          isVerified: user.isVerified
        }
      });
    }
  } catch (error) {
    console.error('❌ Error sending invite:', {
      error: error.message,
      stack: error.stack,
      body: req.body
    });
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get user permissions
// @route   GET /api/users/:id/permissions
// @access  Private (SuperAdmin only)
exports.getUserPermissions = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get role-based permissions
    let rolePermissions = [];
    if (user.role && user.role !== 'SuperAdmin') {
      const role = await Role.findOne({ roleName: user.role });
      if (role && role.permissionIds && role.permissionIds.length > 0) {
        rolePermissions = role.permissionIds;
      }
    }

    // Get user-specific permissions
    const userSpecificPermissions = user.userSpecificPermissions || [];

    // Combine and deduplicate permissions
    const allPermissionIds = [...new Set([...rolePermissions, ...userSpecificPermissions])];

    // Get permission details from Permission model
    let permissions = [];
    try {
      const Permission = require('../models/permissionModel');
      permissions = await Permission.find({
        permissionId: { $in: allPermissionIds }
      }).select('permissionId label description category');
    } catch (permissionError) {
      console.error('⚠️  Error fetching permission details:', permissionError.message);
      // Continue without permission details - return permission IDs only
    }

    // Separate role and user-specific permissions with details
    const rolePermissionsWithDetails = permissions.filter(p => 
      rolePermissions.includes(p.permissionId)
    );
    const userSpecificPermissionsWithDetails = permissions.filter(p => 
      userSpecificPermissions.includes(p.permissionId)
    );

    res.status(200).json({
      success: true,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      },
      permissions: {
        rolePermissions: rolePermissionsWithDetails,
        userSpecificPermissions: userSpecificPermissionsWithDetails,
        allPermissions: permissions
      },
      permissionIds: {
        rolePermissions,
        userSpecificPermissions,
        allPermissionIds
      }
    });
  } catch (error) {
    console.error('❌ Error getting user permissions:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Update user permissions
// @route   PUT /api/users/:id/permissions
// @access  Private (SuperAdmin only)
exports.updateUserPermissions = async (req, res) => {
  try {
    const { userSpecificPermissions } = req.body;
    const userId = req.params.id;

    console.log('\n📝 ===== UPDATE USER PERMISSIONS REQUEST =====');
    console.log('   User ID:', userId);
    console.log('   Request Permissions Count:', userSpecificPermissions?.length || 0);
    if (userSpecificPermissions && Array.isArray(userSpecificPermissions)) {
      console.log('   Request Permissions:', userSpecificPermissions);
    }
    console.log('   Updated By:', req.user?.email || 'unknown');
    console.log('===============================================\n');

    // First, get the user to check existence and get old permissions
    const existingUser = await User.findById(userId);

    if (!existingUser) {
      console.log('❌ User not found:', userId);
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Prevent modifying admin@examples.com permissions (protected user)
    if (existingUser.email === 'admin@examples.com') {
      console.log('❌ Cannot modify protected user permissions');
      return res.status(403).json({
        success: false,
        message: 'Cannot modify admin@examples.com permissions. This user is protected.'
      });
    }

    const oldPermissions = existingUser.userSpecificPermissions || [];

    // Validate input
    if (userSpecificPermissions !== undefined) {
      if (!Array.isArray(userSpecificPermissions)) {
        console.log('❌ Invalid permissions format - must be array');
        return res.status(400).json({
          success: false,
          message: 'userSpecificPermissions must be an array'
        });
      }
    }

    // Process and clean permission IDs
    let newPermissions = [];
    if (userSpecificPermissions !== undefined) {
      newPermissions = userSpecificPermissions
        .map(id => {
          if (typeof id === 'string') {
            return id.trim();
          }
          return String(id).trim();
        })
        .filter(id => id && id.length > 0);
    }

    console.log('📋 Processing permissions update:');
    console.log('   Old Permissions:', oldPermissions);
    console.log('   New Permissions:', newPermissions);

    // Use findByIdAndUpdate to explicitly update the array
    // This ensures the array is properly saved to the database
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          userSpecificPermissions: newPermissions
        }
      },
      {
        new: true, // Return updated document
        runValidators: true // Run schema validators
      }
    );

    if (!updatedUser) {
      console.log('❌ Failed to update user - user not found after update');
      return res.status(404).json({
        success: false,
        message: 'User not found after update'
      });
    }

    // Double-check by fetching fresh from database
    const verifiedUser = await User.findById(userId);
    const savedPermissions = verifiedUser?.userSpecificPermissions || [];

    // Verify the update was successful
    const updateSuccess = JSON.stringify(savedPermissions.sort()) === JSON.stringify(newPermissions.sort());

    if (!updateSuccess) {
      console.error('❌ PERMISSION UPDATE VERIFICATION FAILED!');
      console.error('   Expected:', newPermissions);
      console.error('   Actual:', savedPermissions);
      return res.status(500).json({
        success: false,
        message: 'Permissions update failed verification. Please try again.',
        debug: {
          expected: newPermissions,
          actual: savedPermissions
        }
      });
    }

    console.log('\n✅ ===== USER PERMISSIONS UPDATED SUCCESSFULLY =====');
    console.log('   User ID:', updatedUser._id);
    console.log('   User Email:', updatedUser.email);
    console.log('   Old Permissions Count:', oldPermissions.length);
    console.log('   New Permissions Count:', savedPermissions.length);
    console.log('   Permissions Saved:', savedPermissions);
    console.log('   Verified from Database: ✅');
    console.log('   Updated By:', req.user.email);
    console.log('=====================================================\n');

    // Create audit log
    await createAuditLog(
      req.user._id,
      `Updated permissions for user: ${updatedUser.email}`,
      'Update',
      'User',
      updatedUser._id,
      { userSpecificPermissions: oldPermissions },
      { userSpecificPermissions: savedPermissions },
      req.ip,
      `Permissions updated by ${req.user.role}`
    );

    res.status(200).json({
      success: true,
      message: 'User permissions updated successfully',
      user: {
        _id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
        userSpecificPermissions: savedPermissions
      }
    });
  } catch (error) {
    console.error('\n❌ ===== ERROR UPDATING USER PERMISSIONS =====');
    console.error('   Error:', error.message);
    console.error('   Stack:', error.stack);
    console.error('==============================================\n');
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Upload user profile image
// @route   POST /api/users/upload-image
// @access  Private (SuperAdmin only)
exports.uploadUserProfileImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided'
      });
    }

    // Construct the image URL
    const baseUrl = req.protocol + '://' + req.get('host');
    const imageUrl = `${baseUrl}/uploads/users/${req.file.filename}`;

    res.status(200).json({
      success: true,
      message: 'Image uploaded successfully',
      imageUrl: imageUrl
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to upload image'
    });
  }
};