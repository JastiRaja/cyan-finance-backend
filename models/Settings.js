const mongoose = require('mongoose');

const SettingsSchema = new mongoose.Schema({
  goldRate: {
    type: Number,
    required: true,
    default: 7000
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Settings', SettingsSchema); 