/**
 * Debug script to check user login issues
 * Usage: node scripts/check-user-login.js <email> <password>
 */

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/userModel');

const email = process.argv[2] || 'madhabgmi8@gmail.com';
const password = process.argv[3] || '2tj5J1Mn&m';

async function checkUserLogin() {
  try {
    // Connect to database
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to database\n');

    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();
    console.log('🔍 Checking user:', normalizedEmail);
    console.log('   Password provided:', password);
    console.log('   Password length:', password.length);
    console.log('');

    // Find user
    const user = await User.findOne({ email: normalizedEmail }).select('+password');

    if (!user) {
      console.log('❌ User not found in database');
      console.log('   Searched for:', normalizedEmail);
      console.log('\n💡 Possible issues:');
      console.log('   1. User was not created');
      console.log('   2. Email is stored with different case');
      console.log('   3. Email has extra spaces');
      
      // Try to find similar emails
      const similarUsers = await User.find({
        email: { $regex: normalizedEmail.replace('@', '.*@'), $options: 'i' }
      }).select('email name role');
      
      if (similarUsers.length > 0) {
        console.log('\n📋 Similar emails found:');
        similarUsers.forEach(u => {
          console.log(`   - ${u.email} (${u.name}, ${u.role})`);
        });
      }
      
      await mongoose.connection.close();
      return;
    }

    console.log('✅ User found in database:');
    console.log('   ID:', user._id);
    console.log('   Name:', user.name);
    console.log('   Email:', user.email);
    console.log('   Role:', user.role);
    console.log('   Is Verified:', user.isVerified);
    console.log('   Created At:', user.createdAt);
    console.log('');

    // Check password
    if (!user.password) {
      console.log('❌ User has no password set!');
      console.log('\n💡 Solution:');
      console.log('   1. User needs to reset password');
      console.log('   2. Or admin needs to send invite email');
      await mongoose.connection.close();
      return;
    }

    console.log('🔐 Password check:');
    console.log('   Has password: Yes');
    console.log('   Password hash length:', user.password.length);
    console.log('   Expected hash length: ~60 (for bcrypt)');
    
    const isHashValid = user.password.length > 50 && user.password.startsWith('$2');
    console.log('   Hash format valid:', isHashValid ? 'Yes' : 'No');
    console.log('');

    if (!isHashValid) {
      console.log('❌ Password hash format is invalid!');
      console.log('   Password may not have been hashed during creation');
      console.log('   Hash starts with:', user.password.substring(0, 10));
      await mongoose.connection.close();
      return;
    }

    // Compare password
    console.log('🔑 Comparing password...');
    const isMatch = await bcrypt.compare(password, user.password);
    console.log('   Password match:', isMatch ? '✅ YES' : '❌ NO');
    console.log('');

    if (isMatch) {
      console.log('✅ Password is correct!');
      console.log('   User should be able to login');
      console.log('\n💡 If login still fails, check:');
      console.log('   1. Frontend is sending correct email (lowercase)');
      console.log('   2. Frontend is sending correct password');
      console.log('   3. API endpoint is receiving correct data');
    } else {
      console.log('❌ Password does not match!');
      console.log('\n💡 Possible issues:');
      console.log('   1. Wrong password provided');
      console.log('   2. Password was changed after creation');
      console.log('   3. Password hash was corrupted');
      console.log('\n💡 Solution:');
      console.log('   1. Reset password using forgot password');
      console.log('   2. Or admin can send new invite email');
    }

    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    await mongoose.connection.close();
    process.exit(1);
  }
}

checkUserLogin();

