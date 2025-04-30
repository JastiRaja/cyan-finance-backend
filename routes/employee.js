const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const Loan = require('../models/Loan');
const Customer = require('../models/Customer');
const User = require('../models/User');
const auth = require('../middleware/auth');

// @route   GET /api/employee/check-aadhar/:aadharNumber
// @desc    Check if an Aadhar number exists and get customer details (employee access)
router.get('/check-aadhar/:aadharNumber', auth, async (req, res) => {
    try {
        const loan = await Loan.findOne({
            $or: [
                { aadharNumber: req.params.aadharNumber },
                { customerId: req.params.aadharNumber }
            ]
        });
        if (loan) {
            return res.json({
                exists: true,
                customerDetails: {
                    customerId: loan.customerId,
                    name: loan.name,
                    email: loan.email,
                    primaryMobile: loan.primaryMobile,
                    secondaryMobile: loan.secondaryMobile || '',
                    presentAddress: loan.presentAddress,
                    permanentAddress: loan.permanentAddress,
                    emergencyContact: loan.emergencyContact || { mobile: '', relation: '' }
                }
            });
        }
        res.json({ exists: false });
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/employee/loans
// @desc    Get all loans (employee access)
router.get('/loans', auth, async (req, res) => {
    try {
        const oneMonthAgo = new Date();
        oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
        // Show all except loans closed > 1 month ago
        const loans = await Loan.find({
            $or: [
                { status: { $ne: 'closed' } },
                { status: 'closed', $or: [ { closedDate: { $exists: false } }, { closedDate: { $gte: oneMonthAgo } } ] }
            ]
        }).sort({ createdAt: -1 });
        res.json({
            success: true,
            data: loans
        });
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/employee/customers
// @desc    Get all customers who have taken at least one loan (employee access)
router.get('/customers', auth, async (req, res) => {
    try {
        const customers = await Loan.aggregate([
            {
                $group: {
                    _id: '$aadharNumber',
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
                    aadharNumber: '$_id',
                    name: 1,
                    email: 1,
                    primaryMobile: 1,
                    secondaryMobile: 1,
                    presentAddress: 1,
                    permanentAddress: 1,
                    emergencyContact: 1,
                    totalLoans: 1,
                    activeLoans: 1,
                    _id: 0
                }
            }
        ]);
        res.json({
            success: true,
            data: customers
        });
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   POST /api/employee/loans
// @desc    Create a new loan as employee
router.post('/loans', [
    auth,
    body('aadharNumber')
        .matches(/^\d{12}$/).withMessage('Aadhar number must be exactly 12 digits'),
    body(['amount', 'loanAmount'])
        .optional()
        .isNumeric().withMessage('Loan amount must be a number')
        .isFloat({ min: 100 }).withMessage('Loan amount must be at least 100'),
    body(['term', 'duration'])
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

        console.log('Received request body:', JSON.stringify(req.body, null, 2));
        console.log('User from token:', req.user);

        // Extract customer fields
        const {
            aadharNumber,
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
            loanAmount,
            term,
            duration,
            monthlyPayment,
            totalPayment
        } = req.body;

        // Use the correct field names, falling back to alternates if needed
        const finalAmount = amount || loanAmount;
        const finalTerm = term || duration;

        // Find or create customer
        let customer = await Customer.findOne({ aadharNumber });
        
        if (!customer) {
            // Create new customer
            customer = await Customer.create({
                aadharNumber,
                name,
                email,
                primaryMobile,
                secondaryMobile,
                presentAddress,
                permanentAddress,
                emergencyContact
            });
        } else {
            // Update existing customer's information
            customer.name = name;
            customer.email = email;
            customer.primaryMobile = primaryMobile;
            customer.secondaryMobile = secondaryMobile;
            customer.presentAddress = presentAddress;
            customer.permanentAddress = permanentAddress;
            customer.emergencyContact = emergencyContact;
            await customer.save();
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

        // Create new loan data
        const loanData = {
            customerId: customer._id, // Use the customer's ObjectId
            aadharNumber: customer.aadharNumber,
            name: customer.name,
            email: customer.email,
            primaryMobile: customer.primaryMobile,
            secondaryMobile: customer.secondaryMobile,
            presentAddress: customer.presentAddress,
            permanentAddress: customer.permanentAddress,
            emergencyContact: customer.emergencyContact,
            goldItems,
            interestRate: Number(interestRate),
            amount: Number(finalAmount),
            term: Number(finalTerm),
            monthlyPayment: Number(monthlyPayment),
            totalPayment: Number(totalPayment),
            status: 'active',
            createdBy: req.user._id,
            loanId,
            remainingBalance: Number(totalPayment),
            totalPaid: 0,
            payments: []
        };

        console.log('Creating new loan with data:', JSON.stringify(loanData, null, 2));

        try {
            // Create new loan
            const loan = await Loan.create(loanData);
            console.log('Loan created successfully:', loan);

            res.status(201).json({
                success: true,
                data: loan
            });
        } catch (err) {
            console.error('Error creating loan:', err);
            res.status(500).json({ message: err.message });
        }
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

module.exports = router; 