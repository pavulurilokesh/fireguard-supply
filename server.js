require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// --- very small in-memory rate limiter for auth endpoints ---
// Prevents brute-force login/signup spam without adding an extra dependency.
const attempts = new Map(); // ip -> { count, resetAt }
const WINDOW_MS = 60 * 1000;
const MAX_ATTEMPTS = 20;
app.use('/api/auth', (req, res, next) => {
  const ip = req.ip;
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return next();
  }
  entry.count += 1;
  if (entry.count > MAX_ATTEMPTS) {
    return res.status(429).json({ error: 'Too many attempts. Please try again in a minute.' });
  }
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Serve the frontend
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

async function start() {
  // Database initialization (schema + seed data) can be slow when DB_PATH
  // points at a mounted volume. Await it here, before we start listening,
  // so the server never accepts requests against a half-seeded database —
  // but without blocking module load / require() the way a top-level
  // synchronous seed() call used to.
  await db.initializeDb();

  app.listen(PORT, () => {
    console.log(`FireGuard Supply Co. server running at http://localhost port${3000}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
