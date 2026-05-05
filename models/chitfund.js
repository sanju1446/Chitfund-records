const mongoose = require('mongoose');

const chitFundSchema = new mongoose.Schema(
  {
    tableName: {
      type: String,
      required: [true, 'Table name is required'],
      trim: true,
    },
    amount: {
      type: Number,
      required: [true, 'Amount is required'],
      min: [0, 'Amount cannot be negative'],
    },
    members: [
      {
        name: { type: String, required: true, trim: true },
        phone: { type: String, trim: true },
        paid: { type: Boolean, default: false },
        dueAmount: { type: Number, default: 0 },
      },
    ],
    incharge: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ['active', 'completed', 'pending'],
      default: 'active',
    },
    startDate: {
      type: Date,
      default: Date.now,
    },
    notices: [
      {
        message: { type: String },
        createdAt: { type: Date, default: Date.now },
      },
    ],

    // ── App-state fields (used by the frontend to persist all data) ──────────
    appGroups:        { type: mongoose.Schema.Types.Mixed, default: {} },
    appTrash:         { type: mongoose.Schema.Types.Mixed, default: {} },
    appReminders:     { type: mongoose.Schema.Types.Mixed, default: [] },
    appPenaltyRates:  { type: mongoose.Schema.Types.Mixed, default: {} },
    appTransactions:  { type: mongoose.Schema.Types.Mixed, default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ChitFund', chitFundSchema);