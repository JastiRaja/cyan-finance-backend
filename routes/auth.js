const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const auth = require('../middleware/auth');
const Otp = require('../models/Otp');
const sib = require('sib-api-v3-sdk');
const bcrypt = require('bcryptjs');

// Configure Brevo
const defaultClient = sib.ApiClient.instance;
const apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = process.env.BREVO_API_KEY;

// Helper to send OTP email
async function sendOtpEmail(email, otp) {
  const apiInstance = new sib.TransactionalEmailsApi();
  await apiInstance.sendTransacEmail({
    sender: { email: process.env.EMAIL_FROM, name: 'Cyan Finance' },
    to: [{ email }],
    subject: 'Your OTP for Password Reset',
    htmlContent: `<p>Your OTP for password reset is: <b>${otp}</b></p>`
  });
}

// @route   GET /auth/validate
// @desc    Validate authentication token
router.get('/validate', auth, async (req, res) => {
    try {
        // If we reach here, it means the token is valid (auth middleware passed)
        res.json({ 
            valid: true, 
            user: {
                id: req.user._id,
                name: req.user.name,
                email: req.user.email,
                role: req.user.role
            }
        });
    } catch (err) {
        console.error('Error validating token:', err);
        res.status(401).json({ 
            valid: false, 
            message: 'Invalid token' 
        });
    }
});

// @route   POST /auth/register
// @desc    Register user
router.post('/register', [
    body('name').notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('Please include a valid email'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long')
], async (req, res) => {
    try {
        // Validate input
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { name, email, password } = req.body;

        // Check if user exists
        let user = await User.findOne({ email });
        if (user) {
            return res.status(400).json({ message: 'User already exists' });
        }

        // Create user
        user = await User.create({
            name,
            email,
            password
        });

        // Create token
        const token = user.getSignedJwtToken();

        res.status(201).json({
            success: true,
            token,
            user: {
                _id: user._id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   POST /auth/login
// @desc    Login user
router.post('/login', [
    body('email').isEmail().withMessage('Please include a valid email'),
    body('password').exists().withMessage('Password is required')
], async (req, res) => {
    try {
        // Validate input
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { email, password } = req.body;

        // Check if user exists
        const user = await User.findOne({ email }).select('+password');
        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        // Check password
        const isMatch = await user.matchPassword(password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        // Create token
        const token = user.getSignedJwtToken();

        // Send response with user role
        res.json({
            success: true,
            token,
            user: {
                _id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                mustResetPassword: user.mustResetPassword
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   POST /auth/register-admin
// @desc    Register admin user (temporary, remove in production)
router.post('/register-admin', [
    body('name').notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('Please include a valid email'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { name, email, password } = req.body;

        // Check if user exists
        let user = await User.findOne({ email });
        if (user) {
            return res.status(400).json({ message: 'User already exists' });
        }

        // Create admin user
        user = await User.create({
            name,
            email,
            password,
            role: 'admin' // Set role as admin
        });

        const token = user.getSignedJwtToken();

        res.status(201).json({
            success: true,
            token,
            user: {
                _id: user._id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   POST /auth/refresh-token
// @desc    Refresh authentication token
router.post('/refresh-token', auth, async (req, res) => {
  try {
    // Get user from middleware
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Generate new token
    const token = jwt.sign(
      { id: user.id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Error in refresh token:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// 1. Forgot Password - Send OTP
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email });
  if (!user) return res.status(404).json({ message: 'User not found' });

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min expiry

  // Remove any previous OTPs for this email
  await Otp.deleteMany({ email });

  // Save new OTP
  await Otp.create({ email, otp, expiresAt });

  try {
    await sendOtpEmail(email, otp);
    res.json({ message: 'OTP sent to your email' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to send OTP email' });
  }
});

// 2. Reset Password - Verify OTP and Set New Password (PUBLIC, OTP-based)
router.post('/reset-password', async (req, res) => {
  const { email, otp, newPassword } = req.body;
  const otpRecord = await Otp.findOne({ email, otp });

  if (!otpRecord || otpRecord.expiresAt < new Date()) {
    return res.status(400).json({ message: 'Invalid or expired OTP' });
  }

  const user = await User.findOne({ email });
  if (!user) return res.status(404).json({ message: 'User not found' });

  user.password = newPassword; // Let pre-save hook hash it
  await user.save();

  // Delete OTP after use
  await Otp.deleteMany({ email });

  res.json({ message: 'Password reset successful' });
});

// @route   POST /auth/reset-password/first-login
// @desc    Reset password for first login (AUTH-PROTECTED)
router.post('/reset-password/first-login', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('+password');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        const { password } = req.body;
        if (!password || password.length < 6) {
            return res.status(400).json({ message: 'Password must be at least 6 characters long' });
        }
        user.password = password;
        user.mustResetPassword = false;
        await user.save();
        res.json({ success: true, message: 'Password reset successfully' });
    } catch (err) {
        console.error('Error resetting password:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router; 