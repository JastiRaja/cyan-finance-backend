const mongoose = require('mongoose');

const goldItemSchema = new mongoose.Schema({
    description: String,
    grossWeight: Number,
    netWeight: Number
});

const emergencyContactSchema = new mongoose.Schema({
    mobile: String,
    relation: String
});

const loanSchema = new mongoose.Schema({
    customerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Customer',
        required: true
    },
    aadharNumber: {
        type: String,
        required: [true, 'Please provide Aadhar number'],
        validate: {
            validator: function(v) {
                return /^\d{12}$/.test(v);
            },
            message: props => `${props.value} is not a valid Aadhar number! It should be 12 digits.`
        }
    },
    name: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true
    },
    primaryMobile: {
        type: String,
        required: true
    },
    secondaryMobile: String,
    presentAddress: {
        type: String,
        required: true
    },
    permanentAddress: {
        type: String,
        required: true
    },
    emergencyContact: emergencyContactSchema,
    goldItems: [goldItemSchema],
    amount: {
        type: Number,
        required: [true, 'Please provide loan amount'],
        min: [100, 'Loan amount cannot be less than 100']
    },
    term: {
        type: Number,
        required: [true, 'Please provide loan term in months'],
        min: [1, 'Loan term cannot be less than 1 month']
    },
    interestRate: {
        type: Number,
        required: [true, 'Please provide interest rate'],
        min: [0, 'Interest rate cannot be negative']
    },
    status: {
        type: String,
        enum: ['approved', 'rejected', 'active', 'closed'],
        default: 'active'
    },
    closedDate: {
        type: Date
    },
    monthlyPayment: {
        type: Number,
        required: true
    },
    totalPayment: {
        type: Number,
        required: true
    },
    actualRepaymentDate: {
        type: Date
    },
    actualAmountPaid: {
        type: Number
    },
    paymentMethod: {
        type: String,
        enum: ['handcash', 'online'],
        default: 'handcash'
    },
    transactionId: {
        type: String,
        trim: true
    },
    depositedBank: {
        type: String,
        trim: true
    },
    renewalDate: {
        type: Date
    },
    createdBy: {
        type: mongoose.Schema.ObjectId,
        ref: 'User',
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    payments: [{
        amount: Number,
        date: { type: Date, default: Date.now },
        method: String,
        transactionId: String
    }],
    totalPaid: {
        type: Number,
        default: 0
    },
    loanId: {
        type: String,
        unique: true,
        required: true
    }
});

// Calculate monthly payment before saving
loanSchema.pre('save', function(next) {
    // Convert yearly interest rate to monthly
    const r = (this.interestRate / 100) / 12; // Monthly interest rate from yearly
    const n = this.term; // Number of months
    const p = this.amount; // Principal amount
    
    // Monthly payment formula: P * r * (1 + r)^n / ((1 + r)^n - 1)
    this.monthlyPayment = (p * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    this.totalPayment = this.monthlyPayment * n;
    
    next();
});

// Add method to calculate early repayment amount
loanSchema.methods.calculateEarlyRepaymentAmount = function() {
    if (!this.actualRepaymentDate) {
        return this.totalPayment;
    }

    const startDate = this.createdAt;
    const endDate = this.actualRepaymentDate;
    const monthsUsed = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24 * 30.44)); // Average days per month

    // Convert yearly interest rate to monthly
    const r = (this.interestRate / 100) / 12; // Monthly interest rate from yearly
    const p = this.amount; // Principal amount
    
    // Calculate interest for actual months used
    const interestForUsedMonths = p * r * monthsUsed;
    const totalAmountForUsedMonths = p + interestForUsedMonths;

    return Math.round(totalAmountForUsedMonths);
};

module.exports = mongoose.model('Loan', loanSchema); 