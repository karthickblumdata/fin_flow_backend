const express = require('express');
const router = express.Router();
const { sendOtp, verifyOtp, setPassword } = require('../controllers/otpController');

router.post('/send', sendOtp);
router.post('/verify', verifyOtp);
router.post('/set-password', setPassword);

module.exports = router;
