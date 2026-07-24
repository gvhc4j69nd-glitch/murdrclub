const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db/schema');
const { signToken, requireAuth } = require('../middleware/auth');

const router = express.Router();

function publicUser(u) {
  return { id: u.id, username: u.username, email: u.email, bio: u.bio, is_superadmin: !!u.is_superadmin };
}

router.post('/register', async (req, res) => {
  const { username, email, password, bio } = req.body || {};
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email, and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  const { rows: existing } = await pool.query('SELECT id FROM users WHERE username = $1 OR email = $2', [username, email]);
  if (existing[0]) return res.status(409).json({ error: 'Username or email already taken' });

  const password_hash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    `INSERT INTO users (username, email, password_hash, bio) VALUES ($1, $2, $3, $4) RETURNING *`,
    [username, email, password_hash, bio || '']
  );
  const user = rows[0];
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
  const { rows } = await pool.query('SELECT * FROM users WHERE username = $1 OR email = $1', [username]);
  const user = rows[0];
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  res.json({ token: signToken(user), user: publicUser(user) });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

module.exports = router;
