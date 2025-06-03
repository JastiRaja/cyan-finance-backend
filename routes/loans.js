const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const Loan = require('../models/Loan');
const auth = require('../middleware/auth');
const sib = require('sib-api-v3-sdk');
const defaultClient = sib.ApiClient.instance;
const apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = process.env.BREVO_API_KEY;
const { generatePaymentReceiptPDF } = require('../utils/pdfGenerator');
const nodemailer = require('nodemailer');
const path = require('path');

// @route   POST /api/loans
// @desc    Create a new loan application
router.post('/', [auth, [
    body('amount').isNumeric().withMessage('Amount must be a number'),
    body('purpose').notEmpty().withMessage('Purpose is required'),
    body('term').isNumeric().withMessage('Term must be a number'),
    body('interestRate').isNumeric().withMessage('Interest rate must be a number')
]], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { amount, purpose, term, interestRate } = req.body;

        // Generate custom loanId
        const now = new Date();
        const year = now.getFullYear() % 1000; // last 3 digits
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        // Count loans for this month
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        const loanCount = await Loan.countDocuments({ createdAt: { $gte: monthStart, $lte: monthEnd } }) + 1;
        const loanId = `CY${year}${month}${loanCount.toString().padStart(2, '0')}`;

        const loan = await Loan.create({
            user: req.user.id,
            amount,
            purpose,
            term,
            interestRate,
            loanId
        });

        res.status(201).json({
            success: true,
            data: loan
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/loans
// @desc    Get all loans for a user
router.get('/', auth, async (req, res) => {
    try {
        const loans = await Loan.find({ user: req.user.id });

        res.json({
            success: true,
            data: loans
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/loans/:id
// @desc    Get loan by ID
router.get('/:id', auth, async (req, res) => {
    try {
        const loan = await Loan.findById(req.params.id);

        if (!loan) {
            return res.status(404).json({ message: 'Loan not found' });
        }

        // Make sure user owns loan
        if (loan.user.toString() !== req.user.id) {
            return res.status(401).json({ message: 'Not authorized' });
        }

        res.json({
            success: true,
            data: loan
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/loans/:id/payments
// @desc    Get payment history for a loan
router.get('/:id/payments', auth, async (req, res) => {
    try {
        const loan = await Loan.findById(req.params.id);
        if (!loan) {
            return res.status(404).json({ message: 'Loan not found' });
        }
        // Optionally, check if the user is authorized to view this loan's payments
        // if (loan.user.toString() !== req.user.id) {
        //     return res.status(401).json({ message: 'Not authorized' });
        // }
        res.json({ success: true, data: loan.payments || [] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

async function sendRepaymentEmail({ to, name, amountPaid, totalPaid, totalLoan, toBePaid }) {
  const apiInstance = new sib.TransactionalEmailsApi();
  await apiInstance.sendTransacEmail({
    sender: { email: process.env.EMAIL_FROM, name: 'Cyan Finance' },
    to: [{ email: to, name }],
    subject: 'Loan Repayment Confirmation',
    htmlContent: `
      <p>Dear ${name},</p>
      <p>We have received your repayment of <b>₹${amountPaid}</b>.</p>
      <p><b>Loan Details:</b></p>
      <ul>
        <li>Total Loan Amount: ₹${totalLoan}</li>
        <li>Total Paid: ₹${totalPaid}</li>
        <li>To Be Paid: ₹${toBePaid}</li>
      </ul>
      <p>Thank you for your payment.<br/>Cyan Finance</p>
    `
  });
}

// @route   POST /api/loans/:id/repay
// @desc    Repay a loan (full or partial)
router.post('/:id/repay', [auth, [
    body('amount').isNumeric().withMessage('Amount must be a number'),
    body('paymentMethod').isIn(['handcash', 'online']).withMessage('Invalid payment method'),
    body('transactionId').if(body('paymentMethod').equals('online')).notEmpty().withMessage('Transaction ID is required for online payments')
]], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const loan = await Loan.findById(req.params.id);
        if (!loan) {
            return res.status(404).json({ message: 'Loan not found' });
        }

        if (loan.status === 'closed') {
            return res.status(400).json({ message: 'Loan is already closed' });
        }

        const { amount, paymentMethod, transactionId } = req.body;

        // Add payment to payments array
        loan.payments = loan.payments || [];
        loan.payments.push({
            amount,
            date: new Date(),
            method: paymentMethod,
            transactionId: paymentMethod === 'online' ? transactionId : undefined
        });

        // Update totalPaid first
        loan.totalPaid = (loan.totalPaid || 0) + amount;

        // Calculate the required amount to close the loan as of now
        loan.actualRepaymentDate = new Date();
        const requiredAmount = loan.calculateEarlyRepaymentAmount();

        // Only close the loan if fully paid
        if (loan.totalPaid >= requiredAmount) {
            loan.status = 'closed';
            loan.actualRepaymentDate = new Date();
            loan.closedDate = new Date();
        }

        loan.actualAmountPaid = (loan.actualAmountPaid || 0) + amount;

        // Ensure loanId exists before saving (patch for legacy loans)
        if (!loan.loanId) {
            loan.loanId = loan._id.toString();
        }

        await loan.save();

        // Generate PDF receipt
        let pdfBuffer;
        try {
          const logoPath = path.join(__dirname, '../pages/cyanlogo.png'); // Adjust if needed
          pdfBuffer = await generatePaymentReceiptPDF({
            customerName: loan.name,
            paymentAmount: amount,
            totalPaid: loan.totalPaid,
            totalLoan: loan.amount,
            toBePaid: requiredAmount - loan.totalPaid,
            paymentDate: new Date().toLocaleDateString(),
            loanId: loan.loanId,
            logoPath
          });
        } catch (pdfErr) {
          console.error('Failed to generate PDF receipt:', pdfErr);
        }

        // Send repayment email with PDF attachment
        try {
          const transporter = nodemailer.createTransport({
            host: 'smtp-relay.brevo.com',
            port: 587,
            auth: {
              user: process.env.BREVO_SMTP_USER, // set in .env
              pass: process.env.BREVO_SMTP_PASS  // set in .env
            }
          });
          await transporter.sendMail({
            from: `Cyan Finance <${process.env.EMAIL_FROM}>`,
            to: loan.email,
            subject: 'Loan Repayment Receipt',
            text: 'Please find attached your payment receipt.',
            attachments: pdfBuffer ? [
              {
                filename: 'PaymentReceipt.pdf',
                content: pdfBuffer
              }
            ] : []
          });
        } catch (emailErr) {
          console.error('Failed to send repayment email:', emailErr);
        }

        res.json({
            success: true,
            message: loan.status === 'closed' ? 'Loan repaid and closed successfully' : 'Partial payment received',
            data: {
                loanId: loan.loanId,
                amountPaid: amount,
                totalPaid: loan.totalPaid,
                requiredAmount,
                status: loan.status,
                payments: loan.payments
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/loans/customer/:customerId
// @desc    Get all loans for a specific customer
router.get('/customer/:customerId', auth, async (req, res) => {
    try {
        const loans = await Loan.find({ customerId: req.params.customerId });
        res.json({ success: true, data: loans });
    } catch (err) {
        console.error('Error fetching loans for customer:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router; 