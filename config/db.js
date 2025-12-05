const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGO_URI;
    
    if (!mongoUri) {
      throw new Error('MONGO_URI is not defined in environment variables');
    }
    
    console.log('Attempting to connect to MongoDB...');
    const conn = await mongoose.connect(mongoUri);
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    console.log(`   Database: ${conn.connection.name}`);
  } catch (error) {
    console.error(`❌ MongoDB Connection Error: ${error.message}`);
    
    if (error.message.includes('authentication failed')) {
      console.error('\n🔍 Authentication failed. Please check:');
      console.error('1. Username and password in MONGO_URI');
      console.error('2. Database user exists and has correct password');
      console.error('3. IP address is whitelisted in MongoDB Atlas Network Access');
      console.error('4. Password special characters (@) are URL encoded as %40');
    }
    
    process.exit(1);
  }
};

module.exports = connectDB;
