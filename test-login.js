require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/userModel');

const testLogin = async () => {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    const email = 'admin@example.com';
    const password = 'admin123';

    // Find user
    const user = await User.findOne({ email }).select('+password');

    if (!user) {
      console.log('❌ User not found!');
      process.exit(1);
    }

    console.log('📋 User Details:');
    console.log('   Email:', user.email);
    console.log('   Role:', user.role);
    console.log('   Verified:', user.isVerified);
    console.log('   Has Password:', !!user.password);
    console.log('   Password Hash:', user.password ? user.password.substring(0, 20) + '...' : 'N/A');
    console.log('');

    if (!user.isVerified) {
      console.log('❌ User is not verified!');
      process.exit(1);
    }

    if (!user.password) {
      console.log('❌ User has no password!');
      process.exit(1);
    }

    // Test password comparison
    console.log('🔐 Testing password comparison...');
    const isMatch = await bcrypt.compare(password, user.password);

    if (isMatch) {
      console.log('✅ Password matches! Login should work.');
      console.log('\n✅ Super Admin login credentials are correct!');
    } else {
      console.log('❌ Password does NOT match!');
      console.log('   This means the password was hashed incorrectly.');
      console.log('\n🔧 Fixing password...');
      
      // Fix the password
      user.password = password; // Set plain password, pre-save hook will hash it
      await user.save();
      
      console.log('✅ Password has been reset!');
      console.log('   Try logging in again with: admin@example.com / admin123');
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
};

testLogin();
