require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;

// ── Connect to MongoDB ────────────────────────────────────────────────────────
connectDB();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ── Routes ────────────────────────────────────────────────────────────────────

// Health check — test that the server + DB connection are alive
app.get('/api/health', (req, res) => {
  const mongoose = require('mongoose');
  const dbState = ['Disconnected', 'Connected', 'Connecting', 'Disconnecting'];
  const state = dbState[mongoose.connection.readyState] || 'Unknown';

  res.json({
    success: true,
    server: 'RR Kakatiya Chit Fund API',
    database: state,
    timestamp: new Date().toISOString(),
  });
});

// Chit Fund routes
app.use('/api/chitfunds', require('./routes/chitfunds'));

// ── 404 fallback ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` });
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('🔥 Server Error:', err.stack);
  res.status(500).json({ success: false, message: 'Internal Server Error' });
});

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/api/health`);
});