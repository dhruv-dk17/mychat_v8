require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const { initDB, pool } = require('./db/database');
const roomRoutes = require('./routes/rooms');
const healthRoutes = require('./routes/health');

const app = express();
const DEFAULT_ALLOWED_ORIGINS = [
  'https://mychat-v8.web.app',
  'https://mychat-v8.firebaseapp.com',
  'http://localhost:10000',
  'http://127.0.0.1:10000',
  'http://localhost:5500',
  'http://127.0.0.1:5500'
];

function normalizeOrigin(value) {
  const trimmed = (value || '').trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

const allowedOrigins = Array.from(
  new Set([
    ...DEFAULT_ALLOWED_ORIGINS,
    ...(process.env.ALLOWED_ORIGIN || '')
      .split(',')
      .map(normalizeOrigin)
      .filter(Boolean)
  ])
);

// Security headers
app.use(helmet({ contentSecurityPolicy: false }));

// Required for Render — behind a load balancer
app.set('trust proxy', 1);

// Body parsing — 10kb limit prevents payload attacks
app.use(express.json({ limit: '10kb' }));

// CORS — locked to Firebase Hosting URL only
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true
}));

// Global rate limit: 60 requests/minute
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Slow down.' }
}));

// Routes
app.use('/api/rooms', roomRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/users', require('./routes/users'));
app.use('/api/dead-drops', require('./routes/dead-drops'));

// 404
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Cleanup Cron Job
cron.schedule('0 2 * * *', async () => {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 180); // 6 months
    
    // Delete old accounts
    await pool.query('DELETE FROM users WHERE last_active < $1', [cutoff]);
    // Also delete rooms owned by deleted users or expired
    await pool.query('DELETE FROM rooms WHERE owner_username NOT IN (SELECT username FROM users)');
    await pool.query('DELETE FROM rooms WHERE expires_at < NOW()');
    // Delete expired dead drops
    await pool.query('DELETE FROM dead_drops WHERE expires_at < NOW()');
    console.log('Daily cleanup completed');
  } catch (err) {
    console.error('Cleanup error:', err);
  }
});

const PORT = process.env.PORT || 10000;

async function start() {
  try {
    await initDB();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`✓ Mychat v8 backend running on port ${PORT}`);
      console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (err) {
    console.error('Failed to start:', err);
    process.exit(1);
  }
}

start();
