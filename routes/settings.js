const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');
const Settings = require('../models/Settings');

// @route   GET /settings/gold-rate
// @desc    Get current gold rate
// @access  Public
router.get('/gold-rate', async (req, res) => {
  try {
    const settings = await Settings.findOne();
    res.json({ rate: settings ? settings.goldRate : 7000 });
  } catch (error) {
    console.error('Error fetching gold rate:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /settings/update-gold-rate
// @desc    Update gold rate
// @access  Admin only
router.post('/update-gold-rate', auth, adminAuth, async (req, res) => {
  try {
    const { rate } = req.body;
    
    if (!rate || rate <= 0) {
      return res.status(400).json({ message: 'Invalid gold rate' });
    }

    let settings = await Settings.findOne();
    
    if (settings) {
      settings.goldRate = rate;
      settings.lastUpdated = Date.now();
      await settings.save();
    } else {
      settings = new Settings({
        goldRate: rate,
        lastUpdated: Date.now()
      });
      await settings.save();
    }

    res.json({ message: 'Gold rate updated successfully', rate });
  } catch (error) {
    console.error('Error updating gold rate:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router; 