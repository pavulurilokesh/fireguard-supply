const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET, requireAuth } = require('../middleware/auth');

const router = express.Router();

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// POST /api/auth/signup  -> creates a customer account
router.post('/signup', (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Username and password are required.' });
  }
  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Username must be 3-32 characters (letters, numbers, . _ -).' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(409).json({ error: 'That username is already taken.' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
    .run(username, hash, 'customer');

  const user = { id: info.lastInsertRowid, username, role: 'customer' };
  const token = signToken(user);
  res.status(201).json({ token, user });
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  // Always run bcrypt.compare (even on missing user) to reduce username-enumeration timing signal.
  const hashToCheck = row ? row.password_hash : '$2a$10$invalidsaltinvalidsaltinvalidsalu';
  const ok = bcrypt.compareSync(password, hashToCheck);

  if (!row || !ok) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  const user = { id: row.id, username: row.username, role: row.role };
  const token = signToken(user);
  res.json({ token, user });
});

// GET /api/auth/me -> current user from token
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
