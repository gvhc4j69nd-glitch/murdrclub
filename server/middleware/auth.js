const jwt = require('jsonwebtoken');
const { db } = require('../db/schema');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
}

function requireAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, username, email, bio, is_superadmin FROM users WHERE id = ?').get(payload.id);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Populates req.user if a valid token is present, but never rejects the request.
function optionalAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return next();
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = db.prepare('SELECT id, username, email, bio, is_superadmin FROM users WHERE id = ?').get(payload.id);
  } catch {
    // ignore invalid token, treat as anonymous
  }
  next();
}

function isRegionAdmin(userId, regionKey) {
  const row = db.prepare('SELECT 1 FROM region_admins WHERE user_id = ? AND region_key = ?').get(userId, regionKey);
  return !!row;
}

function requireRegionAdmin(req, res, next) {
  const regionKey = req.params.regionKey || req.body.region_key;
  if (req.user.is_superadmin || isRegionAdmin(req.user.id, regionKey)) return next();
  res.status(403).json({ error: 'Region admin access required' });
}

module.exports = { JWT_SECRET, signToken, requireAuth, optionalAuth, isRegionAdmin, requireRegionAdmin };
