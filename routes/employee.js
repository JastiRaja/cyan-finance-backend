const express = require('express');
const router = express.Router();
const Loan = require('../models/Loan');
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
        const users = await User.find({});
        const userMap = {};
        users.forEach(u => { userMap[u.email] = u._id; });
        const customersWithMongoId = customers.map(c => ({ ...c, mongoId: userMap[c.email] || null }));
        res.json({
            success: true,
            data: customersWithMongoId
        });
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router; 