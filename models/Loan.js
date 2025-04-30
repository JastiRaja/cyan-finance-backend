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

const paymentSchema = new mongoose.Schema({
    amount: {
        type: Number,
        required: true
    },
    date: { 
        type: Date, 
        default: Date.now 
    },
    method: {
        type: String,
        enum: ['handcash', 'online'],
        required: true
    },
    transactionId: String,
    // Track which month's installment this payment is for
    installmentNumber: {
        type: Number,
        required: true
    },
    // Store the remaining balance after this payment
    remainingBalance: {
        type: Number,
        required: true
    }
});

const loanSchema = new mongoose.Schema({
    customerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Customer',
        required: true,
        index: true
    },
    aadharNumber: {
        type: String,
        required: [true, 'Please provide Aadhar number'],
        validate: {
            validator: function(v) {
                return /^\d{12}$/.test(v);
            },
            message: props => `${props.value} is not a valid Aadhar number! It should be 12 digits.`
        },
        index: true
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
    // Track monthly installments separately
    installments: [{
        number: Number,
        dueDate: Date,
        amount: Number,
        status: {
            type: String,
            enum: ['pending', 'partial', 'paid'],
            default: 'pending'
        },
        amountPaid: {
            type: Number,
            default: 0
        }
    }],
    actualRepaymentDate: {
        type: Date
    },
    actualAmountPaid: {
        type: Number,
        default: 0
    },
    remainingBalance: {
        type: Number,
        default: function() {
            return this.totalPayment;
        }
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
    payments: [paymentSchema],
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

// Add index explicitly
loanSchema.index({ aadharNumber: 1 }, { unique: false });

// Calculate monthly payment and set up installments before saving
loanSchema.pre('save', function(next) {
    if (this.isNew) {
        // Convert yearly interest rate to monthly
        const r = (this.interestRate / 100) / 12; // Monthly interest rate from yearly
        const n = this.term; // Number of months
        const p = this.amount; // Principal amount
        
        // Monthly payment formula: P * r * (1 + r)^n / ((1 + r)^n - 1)
        this.monthlyPayment = (p * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
        this.totalPayment = this.monthlyPayment * n;
        this.remainingBalance = this.totalPayment;

        // Create installment schedule
        this.installments = [];
        let currentDate = new Date(this.createdAt);
        
        for (let i = 1; i <= this.term; i++) {
            // Add one month to the date
            currentDate = new Date(currentDate);
            currentDate.setMonth(currentDate.getMonth() + 1);
            
            this.installments.push({
                number: i,
                dueDate: new Date(currentDate),
                amount: this.monthlyPayment,
                status: 'pending',
                amountPaid: 0
            });
        }
    }
    next();
});

// Method to record a payment
loanSchema.methods.recordPayment = async function(paymentAmount, paymentMethod, transactionId = null) {
    // Find the first unpaid or partially paid installment
    const currentInstallment = this.installments.find(inst => 
        inst.status === 'pending' || inst.status === 'partial'
    );

    if (!currentInstallment) {
        throw new Error('No pending installments found');
    }

    // Calculate how much can be applied to current installment
    const remainingForInstallment = currentInstallment.amount - currentInstallment.amountPaid;
    const appliedToInstallment = Math.min(paymentAmount, remainingForInstallment);

    // Update installment
    currentInstallment.amountPaid += appliedToInstallment;
    currentInstallment.status = currentInstallment.amountPaid >= currentInstallment.amount ? 'paid' : 'partial';

    // Create payment record
    const payment = {
        amount: paymentAmount,
        method: paymentMethod,
        transactionId,
        installmentNumber: currentInstallment.number,
        remainingBalance: this.remainingBalance - paymentAmount
    };

    // Update loan totals
    this.totalPaid += paymentAmount;
    this.remainingBalance -= paymentAmount;
    this.payments.push(payment);

    // Check if loan is fully paid
    if (this.remainingBalance <= 0) {
        this.status = 'closed';
        this.closedDate = new Date();
        this.actualRepaymentDate = new Date();
        this.actualAmountPaid = this.totalPaid;
    }

    await this.save();
    return payment;
};

// Add method to calculate early repayment amount
loanSchema.methods.calculateEarlyRepaymentAmount = function() {
    if (!this.actualRepaymentDate) {
        return this.remainingBalance;
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

    return Math.round(Math.max(totalAmountForUsedMonths - this.totalPaid, 0));
};

module.exports = mongoose.model('Loan', loanSchema); 