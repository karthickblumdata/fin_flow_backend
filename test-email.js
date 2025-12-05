// Test script to verify email sending
require('dotenv').config();
const sendOtpEmail = require('./utils/sendOtpEmail');

async function testEmail() {
  console.log('\n🧪 Testing Email Configuration...\n');
  
  // Check environment variables
  console.log('📋 Environment Variables:');
  console.log('   EMAIL_USER:', process.env.EMAIL_USER ? '✅ Set' : '❌ Missing');
  console.log('   EMAIL_PASS:', process.env.EMAIL_PASS ? `✅ Set (length: ${process.env.EMAIL_PASS.length})` : '❌ Missing');
  
  if (process.env.EMAIL_PASS) {
    console.log('   EMAIL_PASS contains spaces:', process.env.EMAIL_PASS.includes(' ') ? '❌ YES (THIS IS THE PROBLEM!)' : '✅ No spaces');
    console.log('   EMAIL_PASS (first 4 chars):', process.env.EMAIL_PASS.substring(0, 4) + '***');
  }
  
  console.log('\n📧 Testing Email Sending...\n');
  
  // Use a test email - replace with your email
  const testEmail = process.env.EMAIL_USER || 'test@example.com';
  const testOtp = '1234';
  
  try {
    await sendOtpEmail(testEmail, testOtp, 'verification');
    console.log('\n✅ Email test completed successfully!');
    console.log('   Check your inbox (and spam folder) for the test email.');
  } catch (error) {
    console.error('\n❌ Email test failed!');
    console.error('   Error:', error.message);
    if (error.message.includes('Invalid login') || error.message.includes('authentication')) {
      console.error('\n🔍 Possible issues:');
      console.error('   1. EMAIL_PASS has spaces (should be removed)');
      console.error('   2. Gmail App Password is incorrect');
      console.error('   3. 2-Step Verification not enabled on Gmail');
      console.error('   4. "Less secure app access" needs to be enabled (if using regular password)');
    }
  }
}

testEmail();

