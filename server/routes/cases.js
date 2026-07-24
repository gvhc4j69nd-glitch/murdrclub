const express = require('express');
const { db } = require('../db/schema');
const { requireAuth, optionalAuth } = require('../middleware/auth');

const router = express.Router();

function caseWithCounts(caseId) {
  return db
    .prepare(
      `SELECT c.*, u.username AS submitted_by_username,
              (SELECT COUNT(*) FROM case_members m WHERE m.case_id = c.id) AS member_count,
              (SELECT COUNT(*) FROM contributions ct WHERE ct.case_id = c.id) AS contribution_count
       FROM cases c
       JOIN users u ON u.id = c.submitted_by
       WHERE c.id = ?`
    )
    .get(caseId);
}

router.get('/', (req, res) => {
  const { region } = req.query;
  const rows = region
    ? db
        .prepare(
          `SELECT c.id, c.title, c.victim_name, c.region_key, c.location, c.date_occurred, c.created_at,
                  (SELECT COUNT(*) FROM case_members m WHERE m.case_id = c.id) AS member_count,
                  (SELECT COUNT(*) FROM contributions ct WHERE ct.case_id = c.id) AS contribution_count
           FROM cases c
           WHERE c.status = 'approved' AND c.region_key = ?
           ORDER BY member_count DESC, c.created_at DESC`
        )
        .all(region)
    : db
        .prepare(
          `SELECT c.id, c.title, c.victim_name, c.region_key, c.location, c.date_occurred, c.created_at,
                  (SELECT COUNT(*) FROM case_members m WHERE m.case_id = c.id) AS member_count,
                  (SELECT COUNT(*) FROM contributions ct WHERE ct.case_id = c.id) AS contribution_count
           FROM cases c
           WHERE c.status = 'approved'
           ORDER BY member_count DESC, c.created_at DESC`
        )
        .all();
  res.json({ cases: rows });
});

router.get('/:id', optionalAuth, (req, res) => {
  const caseRow = caseWithCounts(req.params.id);
  if (!caseRow) return res.status(404).json({ error: 'Case not found' });
  if (caseRow.status !== 'approved' && !(req.user && (req.user.is_superadmin || req.user.id === caseRow.submitted_by))) {
    return res.status(404).json({ error: 'Case not found' });
  }

  const members = db
    .prepare(
      `SELECT u.id, u.username, cm.joined_at
       FROM case_members cm JOIN users u ON u.id = cm.user_id
       WHERE cm.case_id = ? ORDER BY cm.joined_at ASC`
    )
    .all(req.params.id);

  const contributions = db
    .prepare(
      `SELECT ct.id, ct.body, ct.link_url, ct.photo_url, ct.video_url, ct.created_at,
              u.id AS user_id, u.username,
              (SELECT ROUND(AVG(rating), 2) FROM contribution_ratings r WHERE r.contribution_id = ct.id) AS avg_rating,
              (SELECT COUNT(*) FROM contribution_ratings r WHERE r.contribution_id = ct.id) AS rating_count
       FROM contributions ct JOIN users u ON u.id = ct.user_id
       WHERE ct.case_id = ? ORDER BY ct.created_at DESC`
    )
    .all(req.params.id);

  const isMember = req.user
    ? !!db.prepare('SELECT 1 FROM case_members WHERE case_id = ? AND user_id = ?').get(req.params.id, req.user.id)
    : false;

  res.json({ case: caseRow, members, contributions, isMember });
});

router.post('/', requireAuth, (req, res) => {
  const { title, victim_name, region_key, location, date_occurred, summary } = req.body || {};
  if (!title || !region_key || !summary) {
    return res.status(400).json({ error: 'Title, region, and summary are required' });
  }
  const region = db.prepare('SELECT key FROM regions WHERE key = ?').get(region_key);
  if (!region) return res.status(400).json({ error: 'Unknown region' });

  const result = db
    .prepare(
      `INSERT INTO cases (title, victim_name, region_key, location, date_occurred, summary, submitted_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(title, victim_name || '', region_key, location || '', date_occurred || '', summary, req.user.id);

  db.prepare('INSERT OR IGNORE INTO case_members (case_id, user_id) VALUES (?, ?)').run(result.lastInsertRowid, req.user.id);

  res.status(201).json({ case: caseWithCounts(result.lastInsertRowid) });
});

router.post('/:id/join', requireAuth, (req, res) => {
  const caseRow = db.prepare('SELECT id, status FROM cases WHERE id = ?').get(req.params.id);
  if (!caseRow || caseRow.status !== 'approved') return res.status(404).json({ error: 'Case not found' });
  db.prepare('INSERT OR IGNORE INTO case_members (case_id, user_id) VALUES (?, ?)').run(req.params.id, req.user.id);
  res.json({ joined: true });
});

router.delete('/:id/join', requireAuth, (req, res) => {
  db.prepare('DELETE FROM case_members WHERE case_id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ joined: false });
});

module.exports = router;
