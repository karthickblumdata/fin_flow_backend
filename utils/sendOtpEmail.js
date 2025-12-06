const nodemailer = require('nodemailer');

const sendOtpEmail = async (email, otp, purpose = 'verification') => {
  try {
    const emailUser = process.env.EMAIL_USER;
    const emailPass = process.env.EMAIL_PASS;

    if (!emailUser || !emailPass) {
      console.error('❌ Email credentials missing:', {
        hasEmailUser: !!emailUser,
        hasEmailPass: !!emailPass
      });
      throw new Error('Email credentials not configured. Please set EMAIL_USER and EMAIL_PASS in your .env file');
    }

    console.log('📧 Configuring email transporter:', {
      service: 'gmail',
      from: emailUser + ' (Sender/Admin)',
      to: email + ' (Recipient/New User)',
      purpose: purpose
    });

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: emailUser,
        pass: emailPass
      }
    });

    // Verify transporter configuration
    try {
      await transporter.verify();
      console.log('✅ Email transporter verified successfully');
    } catch (verifyError) {
      console.error('❌ Email transporter verification failed:', verifyError.message);
      if (verifyError.code === 'EAUTH' || verifyError.message.includes('Invalid login')) {
        throw new Error('Gmail authentication failed. Please use an App Password instead of your regular Gmail password. See instructions in the error log below.');
      }
      throw verifyError;
    }

    const subject = purpose === 'verification' 
      ? 'Your OTP for Account Verification'
      : 'Your OTP for Password Reset';

    // Generate appropriate email content based on purpose
    let html = '';
    
    if (purpose === 'reset') {
      // Password Reset Email Template
      html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333; margin-bottom: 20px;">${subject}</h2>
          <p style="font-size: 16px; color: #555; margin-bottom: 15px;">You have requested to reset your password. Please use the following OTP code:</p>
          <div style="background-color: #f4f4f4; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 8px; margin: 20px 0; border-radius: 8px; border: 2px solid #2196F3;">
            ${otp}
          </div>
          <p style="font-size: 14px; color: #666; margin-bottom: 20px;">
            <strong>This OTP will expire in 10 minutes.</strong>
          </p>
          <div style="background-color: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
            <p style="font-size: 14px; color: #856404; margin: 0;">
              <strong>Instructions:</strong><br>
              1. Go to the Password Reset page in the app<br>
              2. Enter your registered email: <strong>${email}</strong><br>
              3. Enter the OTP code shown above<br>
              4. Enter your new password and confirm it<br>
              5. Click "Reset Password"
            </p>
          </div>
          <p style="color: #dc3545; font-size: 12px; margin-top: 20px;">
            <strong>Security Notice:</strong> If you didn't request this password reset, please ignore this email and your password will remain unchanged.
          </p>
        </div>
      `;
    } else {
      // Account Verification Email Template (for new user registration)
      const deepLink = `financialflow://set-password?email=${encodeURIComponent(email)}`;
      const webUrl = process.env.FRONTEND_URL || 'http://192.168.0.118:8080';
      const webLink = `${webUrl}/set-password?email=${encodeURIComponent(email)}`;
      
      console.log('🔗 Set Password Links Generated:');
      console.log('   Deep Link (Mobile):', deepLink);
      console.log('   Web Link:', webLink);
      console.log('   Email:', email);
      
      html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333; margin-bottom: 20px;">${subject}</h2>
          <p style="font-size: 16px; color: #555; margin-bottom: 15px;">Your OTP code is:</p>
          <div style="background-color: #f4f4f4; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 8px; margin: 20px 0; border-radius: 8px;">
            ${otp}
          </div>
          <p style="font-size: 14px; color: #666; margin-bottom: 20px;">This OTP will expire in 10 minutes.</p>
          <div style="background-color: #e8f4f8; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #2196F3;">
            <p style="font-size: 16px; color: #333; margin-bottom: 15px; font-weight: 600;">Set Your Password:</p>
            <p style="font-size: 14px; color: #555; margin-bottom: 15px;">Click the button below to open the app and set your password:</p>
            <a href="${deepLink}" style="display: inline-block; background-color: #2196F3; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px; margin-top: 10px; margin-bottom: 15px;">Open App & Set Password</a>
            <p style="font-size: 12px; color: #666; margin-top: 15px; margin-bottom: 10px;">Or use one of these methods:</p>
            <div style="background-color: #f9f9f9; padding: 15px; border-radius: 6px; margin-top: 10px;">
              <p style="font-size: 12px; color: #555; margin-bottom: 8px; font-weight: 600;">📱 Mobile App (Deep Link):</p>
              <p style="font-size: 11px; color: #2196F3; word-break: break-all; margin-bottom: 15px; font-family: monospace;">${deepLink}</p>
              <p style="font-size: 12px; color: #555; margin-bottom: 8px; font-weight: 600;">🌐 Web Browser:</p>
              <p style="font-size: 11px; color: #2196F3; word-break: break-all; font-family: monospace;">${webLink}</p>
            </div>
            <p style="font-size: 11px; color: #666; margin-top: 15px; font-style: italic;">Note: If the app doesn't open, copy the deep link above and paste it in your browser or app.</p>
          </div>
          <p style="color: #666; font-size: 12px; margin-top: 20px;">If you didn't request this, please ignore this email.</p>
        </div>
      `;
    }

    const mailOptions = {
      from: emailUser,
      to: email,
      subject: subject,
      html: html
    };

    console.log('\n📤 ===== SENDING EMAIL =====');
    console.log('   FROM (Admin Email):', emailUser);
    console.log('   TO (Recipient Email):', email);
    console.log('   🔢 OTP CODE IN EMAIL:', otp);
    console.log('   OTP Type:', typeof otp);
    console.log('   OTP Length:', otp.length);
    console.log('   Subject:', subject);
    console.log('   Purpose:', purpose === 'reset' ? 'Password Reset' : 'Account Verification');
    console.log('========================================\n');

    const info = await transporter.sendMail(mailOptions);
    
    console.log('\n✅ ===== EMAIL SENT SUCCESSFULLY =====');
    console.log('   ✅ Status: SENT');
    console.log('   🔢 OTP Code in Email:', otp);
    console.log('   📧 Recipient Email:', email);
    console.log('   📧 Accepted By Server:', info.accepted);
    console.log('   📧 Rejected By Server:', info.rejected || 'None');
    console.log('   📧 Pending:', info.pending || 'None');
    console.log('   📬 Message ID:', info.messageId);
    console.log('   📬 Server Response:', info.response);
    console.log('=====================================\n');

    // Check if email was actually accepted by Gmail
    if (info.rejected && info.rejected.length > 0) {
      console.error('\n❌ ===== EMAIL REJECTED BY GMAIL =====');
      console.error('   ❌ Status: REJECTED');
      console.error('   🔢 OTP Code (NOT DELIVERED):', otp);
      console.error('   📧 Recipient Email:', email);
      console.error('   📧 Rejected Emails:', info.rejected);
      console.error('   Reason: Email address may be invalid or blocked');
      console.error('=====================================\n');
      throw new Error(`Email was rejected by Gmail: ${info.rejected.join(', ')}`);
    }

    if (!info.accepted || info.accepted.length === 0) {
      console.error('\n❌ ===== EMAIL NOT ACCEPTED BY GMAIL =====');
      console.error('   ❌ Status: NOT ACCEPTED');
      console.error('   🔢 OTP Code (NOT DELIVERED):', otp);
      console.error('   📧 Recipient Email:', email);
      console.error('   📧 Accepted:', info.accepted);
      console.error('   📧 Rejected:', info.rejected);
      console.error('==========================================\n');
      throw new Error('Email was not accepted by Gmail server');
    }

    console.log('\n📬 ===== EMAIL DELIVERY CONFIRMED BY GMAIL =====');
    console.log('   ✅ Status: DELIVERED');
    console.log('   🔢 OTP Code Delivered:', otp);
    console.log('   📧 Recipient Email:', email);
    console.log('   📧 Accepted By Gmail:', info.accepted);
    console.log('   📬 Message ID:', info.messageId);
    console.log('   📬 Server Response:', info.response);
    console.log('   ✅ OTP email successfully delivered to recipient email address');
    console.log('================================================\n');

    return true;
  } catch (error) {
    console.error('❌ Email sending error:', {
      error: error.message,
      code: error.code,
      command: error.command,
      response: error.response,
      responseCode: error.responseCode,
      stack: error.stack
    });
    
    // Provide helpful error messages for common issues
    const isAuthError = error.code === 'EAUTH' || 
                       error.message.includes('Invalid login') || 
                       error.message.includes('BadCredentials') ||
                       error.message.includes('535-5.7.8') ||
                       error.message.includes('Username and Password not accepted') ||
                       error.message.includes('Gmail authentication failed');
    
    if (isAuthError) {
      // Instructions already logged in verify() catch block, but log again if error occurred during send
      if (!error.message.includes('See instructions in the error log above')) {
        console.error('\n🔧 ===== GMAIL AUTHENTICATION ERROR - FIX INSTRUCTIONS =====');
        console.error('Gmail requires an App Password, not your regular password.');
        console.error('\n📝 Steps to fix:');
        console.error('1. Go to your Google Account: https://myaccount.google.com/');
        console.error('2. Enable 2-Step Verification (if not already enabled)');
        console.error('3. Go to: https://myaccount.google.com/apppasswords');
        console.error('4. Select "Mail" and "Other (Custom name)"');
        console.error('5. Enter a name like "Node.js App" and click "Generate"');
        console.error('6. Copy the 16-character App Password (without spaces)');
        console.error('7. Update your .env file:');
        console.error('   EMAIL_USER=your-email@gmail.com');
        console.error('   EMAIL_PASS=your-16-char-app-password');
        console.error('\n⚠️  Important: Use the App Password, NOT your regular Gmail password!');
        console.error('=============================================================\n');
      }
      
      throw new Error('Gmail authentication failed. Please use a Gmail App Password. Check the console for detailed instructions.');
    }
    
    throw new Error(`Failed to send email: ${error.message}`);
  }
};

/**
 * Send invite email with username and password
 * @param {string} email - User email (username)
 * @param {string} name - User name
 * @param {string} password - Generated password
 * @returns {Promise<void>}
 */
const sendInviteEmail = async (email, name, password) => {
  try {
    const emailUser = process.env.EMAIL_USER;
    const emailPass = process.env.EMAIL_PASS;

    if (!emailUser || !emailPass) {
      console.error('❌ Email credentials missing:', {
        hasEmailUser: !!emailUser,
        hasEmailPass: !!emailPass
      });
      throw new Error('Email credentials not configured. Please set EMAIL_USER and EMAIL_PASS in your .env file');
    }

    console.log('📧 Configuring email transporter for invite:', {
      service: 'gmail',
      from: emailUser + ' (Sender/Admin)',
      to: email + ' (Recipient/New User)',
      purpose: 'invite'
    });

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: emailUser,
        pass: emailPass
      }
    });

    // Verify transporter configuration
    try {
      await transporter.verify();
      console.log('✅ Email transporter verified successfully');
    } catch (verifyError) {
      console.error('❌ Email transporter verification failed:', verifyError.message);
      
      // Check for specific Gmail authentication errors
      const isAuthError = verifyError.code === 'EAUTH' || 
                         verifyError.message.includes('Invalid login') ||
                         verifyError.message.includes('BadCredentials') ||
                         verifyError.message.includes('535-5.7.8') ||
                         verifyError.message.includes('Username and Password not accepted');
      
      if (isAuthError) {
        // Provide detailed instructions before throwing error
        console.error('\n🔧 ===== GMAIL AUTHENTICATION ERROR - FIX INSTRUCTIONS =====');
        console.error('Gmail requires an App Password, not your regular password.');
        console.error('\n📝 Steps to fix:');
        console.error('1. Go to your Google Account: https://myaccount.google.com/');
        console.error('2. Enable 2-Step Verification (if not already enabled)');
        console.error('3. Go to: https://myaccount.google.com/apppasswords');
        console.error('4. Select "Mail" and "Other (Custom name)"');
        console.error('5. Enter a name like "Node.js App" and click "Generate"');
        console.error('6. Copy the 16-character App Password (without spaces)');
        console.error('7. Update your .env file:');
        console.error('   EMAIL_USER=your-email@gmail.com');
        console.error('   EMAIL_PASS=your-16-char-app-password');
        console.error('\n⚠️  Important: Use the App Password, NOT your regular Gmail password!');
        console.error('=============================================================\n');
        
        throw new Error('Gmail authentication failed. Please use an App Password instead of your regular Gmail password. See instructions in the error log above.');
      }
      throw verifyError;
    }

    const subject = 'Welcome! Your Account Credentials';
    const webUrl = process.env.FRONTEND_URL || 'http://192.168.0.118:8080';
    const loginLink = `${webUrl}/login`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
        <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <div style="text-align: center; margin-bottom: 30px;">
            <h2 style="color: #2196F3; margin-bottom: 10px; font-size: 28px;">Welcome to Financial Flow!</h2>
            <p style="color: #666; font-size: 14px;">Your account has been created successfully</p>
          </div>
          
          <p style="font-size: 16px; color: #555; margin-bottom: 25px;">Hello <strong>${name}</strong>,</p>
          
          <p style="font-size: 16px; color: #555; margin-bottom: 25px; line-height: 1.6;">
            Your account has been created successfully. Please use the following credentials to log in to your account:
          </p>
          
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 25px; border-radius: 12px; margin: 25px 0; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            <p style="font-size: 18px; color: white; margin-bottom: 20px; font-weight: 600; text-align: center;">🔐 Your Login Credentials</p>
            
            <div style="background-color: rgba(255,255,255,0.95); padding: 20px; border-radius: 8px; margin-bottom: 15px;">
              <div style="margin-bottom: 15px;">
                <p style="font-size: 12px; color: #666; margin-bottom: 5px; text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">Username / Email</p>
                <div style="background-color: #f8f9fa; padding: 12px; border-radius: 6px; border: 2px solid #e9ecef;">
                  <p style="color: #2196F3; font-family: 'Courier New', monospace; font-size: 16px; font-weight: 600; margin: 0; word-break: break-all;">${email}</p>
                </div>
              </div>
              
              <div>
                <p style="font-size: 12px; color: #666; margin-bottom: 5px; text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">Password</p>
                <div style="background-color: #f8f9fa; padding: 12px; border-radius: 6px; border: 2px solid #e9ecef;">
                  <p style="color: #2196F3; font-family: 'Courier New', monospace; font-size: 18px; font-weight: bold; margin: 0; letter-spacing: 2px; word-break: break-all;">${password}</p>
                </div>
              </div>
            </div>
            
            <p style="font-size: 12px; color: rgba(255,255,255,0.9); text-align: center; margin: 0;">
              ⚠️ Please save these credentials securely
            </p>
          </div>
          
          <div style="background-color: #e8f4f8; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #2196F3;">
            <p style="font-size: 16px; color: #333; margin-bottom: 15px; font-weight: 600;">📱 Get Started:</p>
            <p style="font-size: 14px; color: #555; margin-bottom: 20px; line-height: 1.6;">Click the button below to log in to your account:</p>
            <div style="text-align: center;">
              <a href="${loginLink}" style="display: inline-block; background-color: #2196F3; color: white; padding: 14px 35px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px; box-shadow: 0 2px 4px rgba(33,150,243,0.3);">Log In Now</a>
            </div>
            <p style="font-size: 12px; color: #666; margin-top: 15px; text-align: center;">
              Or copy and paste this link: <a href="${loginLink}" style="color: #2196F3; word-break: break-all;">${loginLink}</a>
            </p>
          </div>
          
          <div style="background-color: #fff3cd; padding: 18px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #ffc107;">
            <p style="font-size: 14px; color: #856404; margin: 0; line-height: 1.6;">
              <strong>🔒 Security Notice:</strong><br>
              • For your security, please change your password after your first login<br>
              • Keep your credentials confidential and do not share them with anyone<br>
              • If you suspect any unauthorized access, contact support immediately
            </p>
          </div>
          
          <div style="border-top: 1px solid #e9ecef; padding-top: 20px; margin-top: 30px;">
            <p style="font-size: 14px; color: #666; margin-bottom: 10px; line-height: 1.6;">
              If you have any questions or need assistance, please contact our support team.
            </p>
            
            <p style="font-size: 14px; color: #666; margin-top: 20px; margin-bottom: 0;">
              Best regards,<br>
              <strong style="color: #2196F3;">Financial Flow Team</strong>
            </p>
          </div>
        </div>
      </div>
    `;

    const mailOptions = {
      from: `"Financial Flow" <${emailUser}>`,
      to: email,
      subject: subject,
      html: html
    };

    console.log('\n📧 ===== SENDING INVITE EMAIL =====');
    console.log('   FROM (Admin):', emailUser);
    console.log('   TO (New User):', email);
    console.log('   User Name:', name);
    console.log('   Username (Email):', email);
    console.log('   Password:', password);
    console.log('===================================\n');

    const info = await transporter.sendMail(mailOptions);
    
    console.log('✅ ===== INVITE EMAIL SENT SUCCESSFULLY! =====');
    console.log('   ✅ Status: SENT');
    console.log('   📧 Recipient Email:', email);
    console.log('   👤 Recipient Name:', name);
    console.log('   📬 Message ID:', info.messageId);
    console.log('==============================================\n');
    
    return info;
  } catch (error) {
    console.error('\n❌ ===== FAILED TO SEND INVITE EMAIL =====');
    console.error('   ❌ Status: FAILED');
    console.error('   📧 Recipient Email:', email);
    console.error('   👤 Recipient Name:', name);
    console.error('   Error Details:', {
      message: error.message,
      code: error.code,
      response: error.response,
      responseCode: error.responseCode
    });
    console.error('   Stack:', error.stack);
    console.error('==========================================\n');
    
    // Provide helpful error messages for common issues
    const isAuthError = error.code === 'EAUTH' || 
                       error.message.includes('Invalid login') || 
                       error.message.includes('BadCredentials') ||
                       error.message.includes('535-5.7.8') ||
                       error.message.includes('Username and Password not accepted') ||
                       error.message.includes('Gmail authentication failed');
    
    if (isAuthError) {
      // Instructions already logged in verify() catch block, but log again if error occurred during send
      if (!error.message.includes('See instructions in the error log above')) {
        console.error('\n🔧 ===== GMAIL AUTHENTICATION ERROR - FIX INSTRUCTIONS =====');
        console.error('Gmail requires an App Password, not your regular password.');
        console.error('\n📝 Steps to fix:');
        console.error('1. Go to your Google Account: https://myaccount.google.com/');
        console.error('2. Enable 2-Step Verification (if not already enabled)');
        console.error('3. Go to: https://myaccount.google.com/apppasswords');
        console.error('4. Select "Mail" and "Other (Custom name)"');
        console.error('5. Enter a name like "Node.js App" and click "Generate"');
        console.error('6. Copy the 16-character App Password (without spaces)');
        console.error('7. Update your .env file:');
        console.error('   EMAIL_USER=your-email@gmail.com');
        console.error('   EMAIL_PASS=your-16-char-app-password');
        console.error('\n⚠️  Important: Use the App Password, NOT your regular Gmail password!');
        console.error('=============================================================\n');
      }
      
      throw new Error('Failed to send invite email: Gmail authentication failed. Please use a Gmail App Password. Check the console for detailed instructions.');
    }
    
    throw new Error(`Failed to send invite email: ${error.message}`);
  }
};

/**
 * Send password reset email with generated password
 * @param {string} email - User email
 * @param {string} password - Generated password
 * @param {string} name - User name
 * @param {Date} dateOfBirth - User date of birth
 * @returns {Promise<void>}
 */
const sendResetPasswordEmail = async (email, password, name = 'User', dateOfBirth = null) => {
  try {
    const emailUser = process.env.EMAIL_USER;
    const emailPass = process.env.EMAIL_PASS;

    if (!emailUser || !emailPass) {
      console.error('❌ Email credentials missing:', {
        hasEmailUser: !!emailUser,
        hasEmailPass: !!emailPass
      });
      throw new Error('Email credentials not configured. Please set EMAIL_USER and EMAIL_PASS in your .env file');
    }

    console.log('📧 Configuring email transporter for password reset:', {
      service: 'gmail',
      from: emailUser + ' (Sender/Admin)',
      to: email + ' (Recipient)',
      purpose: 'password-reset'
    });

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: emailUser,
        pass: emailPass
      }
    });

    // Verify transporter configuration
    try {
      await transporter.verify();
      console.log('✅ Email transporter verified successfully');
    } catch (verifyError) {
      console.error('❌ Email transporter verification failed:', verifyError.message);
      
      // Check for specific Gmail authentication errors
      const isAuthError = verifyError.code === 'EAUTH' || 
                         verifyError.message.includes('Invalid login') ||
                         verifyError.message.includes('BadCredentials') ||
                         verifyError.message.includes('535-5.7.8') ||
                         verifyError.message.includes('Username and Password not accepted');
      
      if (isAuthError) {
        // Provide detailed instructions before throwing error
        console.error('\n🔧 ===== GMAIL AUTHENTICATION ERROR - FIX INSTRUCTIONS =====');
        console.error('Gmail requires an App Password, not your regular password.');
        console.error('\n📝 Steps to fix:');
        console.error('1. Go to your Google Account: https://myaccount.google.com/');
        console.error('2. Enable 2-Step Verification (if not already enabled)');
        console.error('3. Go to: https://myaccount.google.com/apppasswords');
        console.error('4. Select "Mail" and "Other (Custom name)"');
        console.error('5. Enter a name like "Node.js App" and click "Generate"');
        console.error('6. Copy the 16-character App Password (without spaces)');
        console.error('7. Update your .env file:');
        console.error('   EMAIL_USER=your-email@gmail.com');
        console.error('   EMAIL_PASS=your-16-char-app-password');
        console.error('\n⚠️  Important: Use the App Password, NOT your regular Gmail password!');
        console.error('=============================================================\n');
        
        throw new Error('Gmail authentication failed. Please use an App Password instead of your regular Gmail password. See instructions in the error log above.');
      }
      throw verifyError;
    }

    const subject = 'Your Password Has Been Reset - Financial Flow';
    
    // Format date of birth for display
    let dobDisplay = '';
    if (dateOfBirth) {
      const dob = new Date(dateOfBirth);
      dobDisplay = dob.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    }

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #333; margin-bottom: 20px;">Password Reset Successful</h2>
        <p style="font-size: 16px; color: #555; margin-bottom: 15px;">Hello <strong>${name}</strong>,</p>
        <p style="font-size: 16px; color: #555; margin-bottom: 15px;">Your password has been reset successfully. Please use the following password to log in:</p>
        
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 25px; border-radius: 12px; margin: 25px 0; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <p style="font-size: 18px; color: white; margin-bottom: 20px; font-weight: 600; text-align: center;">🔐 Your New Password</p>
          
          <div style="background-color: rgba(255,255,255,0.95); padding: 20px; border-radius: 8px; margin-bottom: 15px;">
            <div style="margin-bottom: 15px;">
              <p style="font-size: 12px; color: #666; margin-bottom: 5px; text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">Password</p>
              <div style="background-color: #f8f9fa; padding: 12px; border-radius: 6px; border: 2px solid #e9ecef;">
                <p style="color: #2196F3; font-family: 'Courier New', monospace; font-size: 18px; font-weight: bold; margin: 0; letter-spacing: 2px; word-break: break-all;">${password}</p>
              </div>
            </div>
            ${dobDisplay ? `
            <div>
              <p style="font-size: 12px; color: #666; margin-bottom: 5px; text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">Generated From</p>
              <p style="font-size: 14px; color: #555; margin: 0;">Name: <strong>${name}</strong></p>
              <p style="font-size: 14px; color: #555; margin: 0;">Date of Birth: <strong>${dobDisplay}</strong></p>
            </div>
            ` : ''}
          </div>
          
          <p style="font-size: 12px; color: rgba(255,255,255,0.9); text-align: center; margin: 0;">
            ⚠️ Please save this password securely
          </p>
        </div>
        
        <div style="background-color: #e8f4f8; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #2196F3;">
          <p style="font-size: 16px; color: #333; margin-bottom: 15px; font-weight: 600;">📱 Next Steps:</p>
          <p style="font-size: 14px; color: #555; margin-bottom: 10px; line-height: 1.6;">1. Use the password above to log in to your account</p>
          <p style="font-size: 14px; color: #555; margin-bottom: 10px; line-height: 1.6;">2. For security, we recommend changing your password after logging in</p>
        </div>
        
        <div style="background-color: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
          <p style="font-size: 14px; color: #856404; margin: 0;">
            <strong>🔒 Security Notice:</strong> If you didn't request this password reset, please contact support immediately and change your password.
          </p>
        </div>
      </div>
    `;

    const mailOptions = {
      from: `"Financial Flow" <${emailUser}>`,
      to: email,
      subject: subject,
      html: html
    };

    console.log('\n📤 ===== SENDING PASSWORD RESET EMAIL =====');
    console.log('   FROM (Admin):', emailUser);
    console.log('   TO (User):', email);
    console.log('   Password:', password);
    console.log('==========================================\n');

    const info = await transporter.sendMail(mailOptions);
    
    console.log('\n✅ ===== PASSWORD RESET EMAIL SENT SUCCESSFULLY =====');
    console.log('   ✅ Status: SENT');
    console.log('   📧 Recipient Email:', email);
    console.log('   🔐 Password Sent:', password);
    console.log('   📬 Message ID:', info.messageId);
    console.log('==================================================\n');

    return info;
  } catch (error) {
    console.error('\n❌ ===== FAILED TO SEND PASSWORD RESET EMAIL =====');
    console.error('   ❌ Status: FAILED');
    console.error('   📧 Recipient Email:', email);
    console.error('   Error Details:', {
      message: error.message,
      code: error.code,
      response: error.response,
      responseCode: error.responseCode
    });
    console.error('==================================================\n');
    
    // Provide helpful error messages for common issues
    const isAuthError = error.code === 'EAUTH' || 
                       error.message.includes('Invalid login') || 
                       error.message.includes('BadCredentials') ||
                       error.message.includes('535-5.7.8') ||
                       error.message.includes('Username and Password not accepted') ||
                       error.message.includes('Gmail authentication failed');
    
    if (isAuthError) {
      // Instructions already logged in verify() catch block, but log again if error occurred during send
      if (!error.message.includes('See instructions in the error log above')) {
        console.error('\n🔧 ===== GMAIL AUTHENTICATION ERROR - FIX INSTRUCTIONS =====');
        console.error('Gmail requires an App Password, not your regular password.');
        console.error('\n📝 Steps to fix:');
        console.error('1. Go to your Google Account: https://myaccount.google.com/');
        console.error('2. Enable 2-Step Verification (if not already enabled)');
        console.error('3. Go to: https://myaccount.google.com/apppasswords');
        console.error('4. Select "Mail" and "Other (Custom name)"');
        console.error('5. Enter a name like "Node.js App" and click "Generate"');
        console.error('6. Copy the 16-character App Password (without spaces)');
        console.error('7. Update your .env file:');
        console.error('   EMAIL_USER=your-email@gmail.com');
        console.error('   EMAIL_PASS=your-16-char-app-password');
        console.error('\n⚠️  Important: Use the App Password, NOT your regular Gmail password!');
        console.error('=============================================================\n');
      }
      
      throw new Error('Failed to send password reset email: Gmail authentication failed. Please use a Gmail App Password. Check the console for detailed instructions.');
    }
    
    throw new Error(`Failed to send password reset email: ${error.message}`);
  }
};

module.exports = sendOtpEmail;
module.exports.sendInviteEmail = sendInviteEmail;
module.exports.sendResetPasswordEmail = sendResetPasswordEmail;

