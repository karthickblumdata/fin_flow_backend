require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/userModel');

const createSuperAdmin = async () => {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Check if Super Admin already exists
    const existingAdmin = await User.findOne({ role: 'SuperAdmin' });
    if (existingAdmin) {
      console.log('⚠️  Super Admin already exists:', existingAdmin.email);
      process.exit(0);
    }

    // Create Super Admin
    // Note: Don't hash password manually - the userModel pre-save hook will hash it automatically
    const name = 'Super Admin';
    const email = 'admin@example.com'; // Change this to your preferred email
    const password = 'admin123'; // Change this to your preferred password

    const superAdmin = await User.create({
      name: name,
      email: email,
      password: password, // Set plain password - pre-save hook will hash it
      role: 'SuperAdmin',
      isVerified: true
    });

    console.log('\n✅ Super Admin created successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Email:', email);
    console.log('Password:', password);
    console.log('Role: SuperAdmin');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n⚠️  Please save these credentials securely!');
    console.log('You can now login using these credentials.\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.code === 11000) {
      console.error('A user with this email already exists.');
    }
    process.exit(1);
  }
};

createSuperAdmin();
