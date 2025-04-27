const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Please provide a name'],
        trim: true
    },
    email: {
        type: String,
        required: [true, 'Please provide an email'],
        unique: true,
        match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email']
    },
    password: {
        type: String,
        required: [true, 'Please provide a password'],
        minlength: 6,
        select: false
    },
    role: {
        type: String,
        enum: ['user', 'admin', 'employee'],
        default: 'user'
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    primaryMobile: {
        type: String,
        trim: true
    },
    secondaryMobile: {
        type: String,
        trim: true
    },
    presentAddress: {
        type: String,
        trim: true
    },
    permanentAddress: {
        type: String,
        trim: true
    },
    emergencyContact: {
        mobile: { type: String, trim: true },
        relation: { type: String, trim: true }
    },
    aadharNumber: {
        type: String,
        validate: {
            validator: function(v) {
                // If role is employee, Aadhar is required and must be 12 digits
                if (this.role === 'employee') {
                    return v && /^\d{12}$/.test(v);
                }
                // For other roles, Aadhar is optional but if provided must be 12 digits
                return !v || /^\d{12}$/.test(v);
            },
            message: props => 'Aadhar number must be exactly 12 digits and is required for employees'
        }
    },
    mustResetPassword: {
        type: Boolean,
        default: false
    }
});

// Hash password before saving
userSchema.pre('save', async function(next) {
    if (!this.isModified('password')) {
        next();
    }
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
});

// Sign JWT and return
userSchema.methods.getSignedJwtToken = function() {
    return jwt.sign({ id: this._id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRE
    });
};

// Match password
userSchema.methods.matchPassword = async function(enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema); 