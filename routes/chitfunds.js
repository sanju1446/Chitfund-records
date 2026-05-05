const express = require('express');
const router = express.Router();
const ChitFund = require('../models/ChitFund');

// GET /api/chitfunds — fetch all chit fund tables
router.get('/', async (req, res) => {
  try {
    const funds = await ChitFund.find().sort({ createdAt: -1 });
    res.json({ success: true, count: funds.length, data: funds });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/chitfunds/:id — fetch a single chit fund by ID
router.get('/:id', async (req, res) => {
  try {
    const fund = await ChitFund.findById(req.params.id);
    if (!fund) {
      return res.status(404).json({ success: false, message: 'Chit fund not found' });
    }
    res.json({ success: true, data: fund });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/chitfunds — create a new chit fund table
router.post('/', async (req, res) => {
  try {
    const fund = await ChitFund.create(req.body);
    console.log(`📋 New chit fund created: ${fund.tableName}`);
    res.status(201).json({ success: true, data: fund });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// PUT /api/chitfunds/:id — update a chit fund
router.put('/:id', async (req, res) => {
  try {
    const fund = await ChitFund.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!fund) {
      return res.status(404).json({ success: false, message: 'Chit fund not found' });
    }
    res.json({ success: true, data: fund });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// DELETE /api/chitfunds/:id — soft delete (move to bin) by updating status
router.delete('/:id', async (req, res) => {
  try {
    const fund = await ChitFund.findByIdAndUpdate(
      req.params.id,
      { status: 'pending' }, // soft delete — move to bin
      { new: true }
    );
    if (!fund) {
      return res.status(404).json({ success: false, message: 'Chit fund not found' });
    }
    console.log(`🗑 Chit fund moved to bin: ${fund.tableName}`);
    res.json({ success: true, message: 'Moved to bin', data: fund });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;