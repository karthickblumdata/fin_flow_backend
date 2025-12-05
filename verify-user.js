// Script to verify a user account
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/userModel');
const connectDB = require('./config/db');

async function verifyUser() {
  try {
    // Connect to database
    await connectDB();
    
    const email = 'madhanbgmi8@gmail.com';
    
    console.log('\n🔍 Verifying user account...\n');
    console.log('Email:', email);
    
    const user = await User.findOne({ email });
    
    if (!user) {
      console.log('❌ User not found:', email);
      process.exit(1);
    }
    
    console.log('\n📋 Current User Status:');
    console.log('   Name:', user.name);
    console.log('   Email:', user.email);
    console.log('   Role:', user.role);
    console.log('   Is Verified:', user.isVerified ? '✅ Yes' : '❌ No');
    
    if (user.isVerified) {
      console.log('\n✅ User is already verified!');
      process.exit(0);
    }
    
    // Verify the user
    user.isVerified = true;
    await user.save();
    
    console.log('\n✅ User verified successfully!');
    console.log('   User can now login.');
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

verifyUser();

