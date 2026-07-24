const express = require('express');
const { db } = require('../db/schema');
const { requireAuth, isRegionAdmin } = require('../middleware/auth');

const router = express.Router();

// Regions this user administers (all of them, if superadmin).
function adminRegions(user) {
  if (user.is_superadmin) return db.prepare('SELECT key FROM regions').all().map(r => r.key);
  return db.prepare('SELECT region_key FROM region_admins WHERE user_id = ?').all(user.id).map(r => r.region_key);
}

router.use(requireAuth, (req, res, next) => {
  req.adminRegions = adminRegions(req.user);
  if (!req.user.is_superadmin && req.adminRegions.length === 0) {
    return res.status(403).json({ error: 'Region admin access required' });
  }
  next();
});

// Pending case submissions across the regions this admin covers.
router.get('/pending', (req, res) => {
  if (req.adminRegions.length === 0) return res.json({ cases: [] });
  const placeholders = req.adminRegions.map(() => '?').join(',');
  const cases = db
    .prepare(
      `SELECT c.*, u.username AS submitted_by_username, r.name AS region_name
       FROM cases c
       JOIN users u ON u.id = c.submitted_by
       JOIN regions r ON r.key = c.region_key
       WHERE c.status = 'pending' AND c.region_key IN (${placeholders})
       ORDER BY c.created_at ASC`
    )
    .all(...req.adminRegions);
  res.json({ cases });
});

router.post('/cases/:id/approve', (req, res) => {
  const caseRow = db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.id);
  if (!caseRow) return res.status(404).json({ error: 'Case not found' });
  if (!req.user.is_superadmin && !isRegionAdmin(req.user.id, caseRow.region_key)) {
    return res.status(403).json({ error: 'Not an admin for this region' });
  }
  db.prepare(`UPDATE cases SET status = 'approved', reviewed_by = ?, review_note = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(req.user.id, req.body?.note || '', req.params.id);
  res.json({ case: db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.id) });
});

router.post('/cases/:id/reject', (req, res) => {
  const caseRow = db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.id);
  if (!caseRow) return res.status(404).json({ error: 'Case not found' });
  if (!req.user.is_superadmin && !isRegionAdmin(req.user.id, caseRow.region_key)) {
    return res.status(403).json({ error: 'Not an admin for this region' });
  }
  db.prepare(`UPDATE cases SET status = 'rejected', reviewed_by = ?, review_note = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(req.user.id, req.body?.note || '', req.params.id);
  res.json({ case: db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.id) });
});

// --- Superadmin: manage who administers which region ---

router.get('/region-admins', (req, res) => {
  if (!req.user.is_superadmin) return res.status(403).json({ error: 'Superadmin access required' });
  const admins = db
    .prepare(
      `SELECT ra.id, ra.region_key, r.name AS region_name, u.id AS user_id, u.username
       FROM region_admins ra JOIN regions r ON r.key = ra.region_key JOIN users u ON u.id = ra.user_id
       ORDER BY r.sort_order`
    )
    .all();
  res.json({ admins });
});

router.post('/region-admins', (req, res) => {
  if (!req.user.is_superadmin) return res.status(403).json({ error: 'Superadmin access required' });
  const { username, region_key } = req.body || {};
  const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const region = db.prepare('SELECT key FROM regions WHERE key = ?').get(region_key);
  if (!region) return res.status(400).json({ error: 'Unknown region' });
  db.prepare('INSERT OR IGNORE INTO region_admins (user_id, region_key) VALUES (?, ?)').run(user.id, region_key);
  res.status(201).json({ ok: true });
});

router.delete('/region-admins/:id', (req, res) => {
  if (!req.user.is_superadmin) return res.status(403).json({ error: 'Superadmin access required' });
  db.prepare('DELETE FROM region_admins WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
