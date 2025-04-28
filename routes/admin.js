const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const Loan = require('../models/Loan');
const User = require('../models/User');
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');
const { sendBrevoEmail } = require('../utils/brevo');
const crypto = require('crypto');

// @route   GET /api/admin/check-aadhar/:aadharNumber
// @desc    Check if an Aadhar number exists and get customer details
router.get('/check-aadhar/:aadharNumber', [auth, adminAuth], async (req, res) => {
    try {
        console.log('Checking Aadhar:', req.params.aadharNumber);
        // Check both aadharNumber and customerId fields
        const loan = await Loan.findOne({
            $or: [
                { aadharNumber: req.params.aadharNumber },
                { customerId: req.params.aadharNumber }
            ]
        });
        console.log('Found loan:', loan);
        
        if (loan) {
            return res.json({
                exists: true,
                customerDetails: {
                    customerId: loan.customerId,
                    name: loan.name,
                    email: loan.email,
                    primaryMobile: loan.primaryMobile,
                    presentAddress: loan.presentAddress,
                    permanentAddress: loan.permanentAddress
                }
            });
        }
        res.json({ exists: false });
    } catch (err) {
        console.error('Error checking Aadhar:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   POST /api/admin/loans
// @desc    Create a new loan as admin
router.post('/loans', [
    auth,
    adminAuth,
    body('aadharNumber')
        .matches(/^\d{12}$/).withMessage('Aadhar number must be exactly 12 digits'),
    // Validate numeric fields with correct field names
    body(['amount', 'loanAmount']) // Accept both field names
        .optional()
        .isNumeric().withMessage('Loan amount must be a number')
        .isFloat({ min: 100 }).withMessage('Loan amount must be at least 100'),
    body(['term', 'duration']) // Accept both field names
        .optional()
        .isNumeric().withMessage('Duration must be a number')
        .isInt({ min: 1 }).withMessage('Duration must be at least 1 month'),
    body('interestRate')
        .exists().withMessage('Interest rate is required')
        .isNumeric().withMessage('Interest rate must be a number')
        .isFloat({ min: 0 }).withMessage('Interest rate cannot be negative'),
    body('monthlyPayment')
        .exists().withMessage('Monthly payment is required')
        .isNumeric().withMessage('Monthly payment must be a number'),
    body('totalPayment')
        .exists().withMessage('Total payment is required')
        .isNumeric().withMessage('Total payment must be a number')
], async (req, res) => {
    try {
        // Check for validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            console.log('Express-validator errors:', errors.array());
            return res.status(400).json({ errors: errors.array() });
        }

        // Check if Aadhar number already exists
        const existingLoan = await Loan.findOne({ aadharNumber: req.body.aadharNumber });
        if (existingLoan) {
            return res.status(400).json({
                errors: [{ 
                    msg: 'Aadhar number already exists',
                    customerDetails: {
                        customerId: existingLoan.customerId,
                        name: existingLoan.name,
                        email: existingLoan.email,
                        primaryMobile: existingLoan.primaryMobile,
                        presentAddress: existingLoan.presentAddress,
                        permanentAddress: existingLoan.permanentAddress
                    }
                }]
            });
        }

        console.log('Received request body:', JSON.stringify(req.body, null, 2));
        console.log('User from token:', req.user);

        // Extract fields, handling both naming conventions
        const {
            customerId,
            name,
            email,
            primaryMobile,
            secondaryMobile,
            presentAddress,
            permanentAddress,
            emergencyContact,
            goldItems,
            interestRate,
            amount,
            loanAmount, // Handle both names
            term,
            duration, // Handle both names
            monthlyPayment,
            totalPayment
        } = req.body;

        // Use the correct field names, falling back to alternates if needed
        const finalAmount = amount || loanAmount;
        const finalTerm = term || duration;

        // Validate required fields
        const requiredFields = {
            customerId,
            name,
            email,
            primaryMobile,
            presentAddress,
            permanentAddress,
            amount: finalAmount,
            term: finalTerm,
            interestRate
        };

        const missingFields = Object.entries(requiredFields)
            .filter(([_, value]) => !value)
            .map(([field]) => field);

        if (missingFields.length > 0) {
            return res.status(400).json({
                errors: missingFields.map(field => ({
                    msg: `${field} is required`
                }))
            });
        }

        // Validate goldItems array
        if (!Array.isArray(goldItems) || goldItems.length === 0) {
            return res.status(400).json({
                errors: [{ msg: 'At least one gold item must be provided' }]
            });
        }

        // Validate each gold item
        const invalidGoldItems = goldItems.filter(
            item => !item.description || !item.grossWeight || !item.netWeight
        );

        if (invalidGoldItems.length > 0) {
            return res.status(400).json({
                errors: [{ msg: 'Each gold item must have description, grossWeight, and netWeight' }]
            });
        }

        // Generate custom loanId
        const now = new Date();
        const year = now.getFullYear() % 1000; // last 3 digits
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        const loanCount = await Loan.countDocuments({ createdAt: { $gte: monthStart, $lte: monthEnd } }) + 1;
        const loanId = `CY${year}${month}${loanCount.toString().padStart(2, '0')}`;

        // Log the data being sent to Loan.create
        const loanData = {
            customerId,
            aadharNumber: customerId, // Store Aadhar number in both fields
            name,
            email,
            primaryMobile,
            secondaryMobile,
            presentAddress,
            permanentAddress,
            emergencyContact,
            goldItems,
            interestRate: Number(interestRate),
            amount: Number(finalAmount),
            term: Number(finalTerm),
            monthlyPayment: Number(monthlyPayment),
            totalPayment: Number(totalPayment),
            status: 'active',
            createdBy: req.user._id,
            loanId
        };

        console.log('Creating loan with data:', JSON.stringify(loanData, null, 2));

        // Create loan
        const loan = await Loan.create(loanData);
        console.log('Loan created successfully:', loan);

        res.status(201).json({
            success: true,
            data: loan
        });
    } catch (err) {
        console.error('Error creating loan:', err);
        console.error('Error details:', {
            name: err.name,
            message: err.message,
            stack: err.stack
        });

        // Check for specific MongoDB validation errors
        if (err.name === 'ValidationError') {
            const validationErrors = Object.values(err.errors).map(error => ({
                msg: error.message
            }));
            return res.status(400).json({ errors: validationErrors });
        }

        // Check for MongoDB duplicate key errors
        if (err.code === 11000) {
            return res.status(400).json({
                errors: [{ msg: 'Duplicate key error. This record already exists.' }]
            });
        }

        res.status(500).json({ 
            message: 'Server error',
            error: err.message,
            details: err.name
        });
    }
});

// @route   GET /api/admin/loans
// @desc    Get all loans (admin only)
router.get('/loans', [auth, adminAuth], async (req, res) => {
    try {
        const loans = await Loan.find().sort({ createdAt: -1 });
        res.json({
            success: true,
            data: loans
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/admin/customers
// @desc    Get all customers who have taken at least one loan
router.get('/customers', [auth, adminAuth], async (req, res) => {
    try {
        const customers = await Loan.aggregate([
            {
                $group: {
                    _id: '$customerId',
                    aadharNumber: { $first: '$aadharNumber' },
                    name: { $first: '$name' },
                    email: { $first: '$email' },
                    primaryMobile: { $first: '$primaryMobile' },
                    secondaryMobile: { $first: '$secondaryMobile' },
                    presentAddress: { $first: '$presentAddress' },
                    permanentAddress: { $first: '$permanentAddress' },
                    emergencyContact: { $first: '$emergencyContact' },
                    totalLoans: { $sum: 1 },
                    activeLoans: {
                        $sum: {
                            $cond: [{ $eq: ['$status', 'active'] }, 1, 0]
                        }
                    }
                }
            },
            {
                $project: {
                    _id: 1,
                    aadharNumber: 1,
                    name: 1,
                    email: 1,
                    primaryMobile: 1,
                    secondaryMobile: 1,
                    presentAddress: 1,
                    permanentAddress: 1,
                    emergencyContact: 1,
                    totalLoans: 1,
                    activeLoans: 1
                }
            }
        ]);

        // Fetch the actual User _id for each customerId (aadhar)
        const users = await User.find({});
        const userMap = {};
        users.forEach(u => { userMap[u.email] = u._id; });
        const customersWithMongoId = customers.map(c => ({ ...c, mongoId: userMap[c.email] || null }));

        res.json({
            success: true,
            data: customersWithMongoId
        });
    } catch (err) {
        console.error('Error fetching customers:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   PUT /api/admin/loans/:id
// @desc    Update a loan as admin
router.put('/loans/:id', [auth, adminAuth], async (req, res) => {
  try {
    const { goldItems, depositedBank, renewalDate } = req.body;

    // Validate the loan exists
    const loan = await Loan.findById(req.params.id);
    if (!loan) {
      return res.status(404).json({ message: 'Loan not found' });
    }

    // Update the loan
    loan.goldItems = goldItems;
    loan.depositedBank = depositedBank;
    loan.renewalDate = renewalDate;

    await loan.save();

    res.json({
      success: true,
      data: loan
    });
  } catch (err) {
    console.error('Error updating loan:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/admin/customers/:id
// @desc    Update a customer as admin
router.put('/customers/:id', [auth, adminAuth], async (req, res) => {
  try {
    const allowedFields = [
      'name', 'email', 'primaryMobile', 'secondaryMobile',
      'presentAddress', 'permanentAddress', 'emergencyContact'
    ];
    const update = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) update[field] = req.body[field];
    }
    const updated = await User.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!updated) return res.status(404).json({ message: 'Customer not found' });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/admin/customers/:id
// @desc    Delete a customer by ID (admin only)
router.delete('/customers/:id', [auth, adminAuth], async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    if (user.role === 'admin') {
      return res.status(403).json({ message: 'Cannot delete an admin user.' });
    }
    await user.deleteOne();
    res.json({ success: true, message: 'Customer deleted successfully' });
  } catch (err) {
    console.error('Error deleting customer:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/admin/employees
// @desc    Register a new employee (admin only)
router.post('/employees', [
    auth,
    adminAuth,
    body('email').isEmail().withMessage('Please include a valid email'),
    body('name').notEmpty().withMessage('Name is required'),
    body('mobile').notEmpty().withMessage('Mobile number is required'),
    body('aadharNumber')
        .matches(/^\d{12}$/)
        .withMessage('Aadhar number must be exactly 12 digits'),
    body('role').isIn(['employee', 'admin']).withMessage('Invalid role')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { email, name, mobile, alternateMobile, role, aadharNumber } = req.body;

        // Check if user already exists
        const existing = await User.findOne({ 
            $or: [
                { email },
                { aadharNumber }
            ]
        });
        
        if (existing) {
            return res.status(400).json({ 
                message: existing.email === email ? 
                    'Email already registered' : 
                    'Aadhar number already registered'
            });
        }

        // Generate random password
        const password = crypto.randomBytes(6).toString('base64');

        // Create user
        const user = await User.create({
            email,
            name,
            password,
            role,
            primaryMobile: mobile,
            secondaryMobile: alternateMobile,
            aadharNumber,
            mustResetPassword: true
        });

        // Send email with password
        await sendBrevoEmail({
            to: email,
            subject: 'Your Cyan Finance Employee Account',
            html: `<p>Hello ${name},</p><p>Your employee account has been created.<br>Email: <b>${email}</b><br>Password: <b>${password}</b></p><p>Please log in and change your password after first login.</p>`
        });

        res.json({ 
            success: true, 
            message: 'Employee registered and email sent.',
            data: {
                _id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                aadharNumber: user.aadharNumber
            }
        });
    } catch (err) {
        console.error('Error registering employee:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/admin/employees
// @desc    Get all employees (admin only)
router.get('/employees', [auth, adminAuth], async (req, res) => {
  try {
    const employees = await User.find({ role: { $in: ['employee', 'admin'] } }).select('-password');
    res.json({ success: true, data: employees });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/admin/employees/:id
// @desc    Delete an employee (admin only)
router.delete('/employees/:id', [auth, adminAuth], async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'Employee not found' });
    }
    if (user.role !== 'employee') {
      return res.status(400).json({ message: 'Can only delete users with employee role' });
    }
    await user.deleteOne();
    res.json({ success: true, message: 'Employee deleted successfully' });
  } catch (err) {
    console.error('Error deleting employee:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/admin/employees/:id
// @desc    Update an employee (admin only)
router.put('/employees/:id', [auth, adminAuth], async (req, res) => {
  try {
    const allowedFields = [
      'name', 'primaryMobile', 'secondaryMobile', 'role'
    ];
    const update = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) update[field] = req.body[field];
    }
    const updated = await User.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!updated) return res.status(404).json({ message: 'Employee not found' });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router; 