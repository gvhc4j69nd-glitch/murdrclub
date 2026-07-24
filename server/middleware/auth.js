const jwt = require('jsonwebtoken');
const { pool } = require('../db/schema');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
}

async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const { rows } = await pool.query(
      'SELECT id, username, email, bio, is_superadmin FROM users WHERE id = $1',
      [payload.id]
    );
    if (!rows[0]) return res.status(401).json({ error: 'Unauthorized' });
    req.user = rows[0];
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Populates req.user if a valid token is present, but never rejects the request.
async function optionalAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return next();
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const { rows } = await pool.query(
      'SELECT id, username, email, bio, is_superadmin FROM users WHERE id = $1',
      [payload.id]
    );
    req.user = rows[0];
  } catch {
    // ignore invalid token, treat as anonymous
  }
  next();
}

async function isRegionAdmin(userId, regionKey) {
  const { rows } = await pool.query(
    'SELECT 1 FROM region_admins WHERE user_id = $1 AND region_key = $2',
    [userId, regionKey]
  );
  return rows.length > 0;
}

async function requireRegionAdmin(req, res, next) {
  const regionKey = req.params.regionKey || req.body.region_key;
  if (req.user.is_superadmin || (await isRegionAdmin(req.user.id, regionKey))) return next();
  res.status(403).json({ error: 'Region admin access required' });
}

module.exports = { JWT_SECRET, signToken, requireAuth, optionalAuth, isRegionAdmin, requireRegionAdmin };
