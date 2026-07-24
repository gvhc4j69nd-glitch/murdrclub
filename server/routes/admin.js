const express = require('express');
const { pool } = require('../db/schema');
const { requireAuth, isRegionAdmin } = require('../middleware/auth');
const { runResearchForCase } = require('../lib/research');

const router = express.Router();

// Regions this user administers (all of them, if superadmin).
async function adminRegions(user) {
  if (user.is_superadmin) {
    const { rows } = await pool.query('SELECT key FROM regions');
    return rows.map(r => r.key);
  }
  const { rows } = await pool.query('SELECT region_key FROM region_admins WHERE user_id = $1', [user.id]);
  return rows.map(r => r.region_key);
}

router.use(requireAuth, async (req, res, next) => {
  req.adminRegions = await adminRegions(req.user);
  if (!req.user.is_superadmin && req.adminRegions.length === 0) {
    return res.status(403).json({ error: 'Region admin access required' });
  }
  next();
});

// Pending case submissions across the regions this admin covers.
router.get('/pending', async (req, res) => {
  if (req.adminRegions.length === 0) return res.json({ cases: [] });
  const { rows } = await pool.query(
    `SELECT c.*, u.username AS submitted_by_username, r.name AS region_name
     FROM cases c
     JOIN users u ON u.id = c.submitted_by
     JOIN regions r ON r.key = c.region_key
     WHERE c.status = 'pending' AND c.region_key = ANY($1::text[])
     ORDER BY c.created_at ASC`,
    [req.adminRegions]
  );
  res.json({ cases: rows });
});

router.post('/cases/:id/approve', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM cases WHERE id = $1', [req.params.id]);
  const caseRow = rows[0];
  if (!caseRow) return res.status(404).json({ error: 'Case not found' });
  if (!req.user.is_superadmin && !(await isRegionAdmin(req.user.id, caseRow.region_key))) {
    return res.status(403).json({ error: 'Not an admin for this region' });
  }
  const { rows: updated } = await pool.query(
    `UPDATE cases SET status = 'approved', reviewed_by = $1, review_note = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
    [req.user.id, req.body?.note || '', req.params.id]
  );
  runResearchForCase(updated[0].id).catch(err => console.error('Research kickoff failed:', err.message));
  res.json({ case: updated[0] });
});

router.post('/cases/:id/reject', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM cases WHERE id = $1', [req.params.id]);
  const caseRow = rows[0];
  if (!caseRow) return res.status(404).json({ error: 'Case not found' });
  if (!req.user.is_superadmin && !(await isRegionAdmin(req.user.id, caseRow.region_key))) {
    return res.status(403).json({ error: 'Not an admin for this region' });
  }
  const { rows: updated } = await pool.query(
    `UPDATE cases SET status = 'rejected', reviewed_by = $1, review_note = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
    [req.user.id, req.body?.note || '', req.params.id]
  );
  res.json({ case: updated[0] });
});

// Pending solve requests across the regions this admin covers.
router.get('/solve-requests', async (req, res) => {
  if (req.adminRegions.length === 0) return res.json({ solveRequests: [] });
  const { rows } = await pool.query(
    `SELECT sr.*, c.title AS case_title, c.region_key, r.name AS region_name, u.username AS requested_by_username
     FROM solve_requests sr
     JOIN cases c ON c.id = sr.case_id
     JOIN regions r ON r.key = c.region_key
     JOIN users u ON u.id = sr.requested_by
     WHERE sr.status = 'pending' AND c.region_key = ANY($1::text[])
     ORDER BY sr.created_at ASC`,
    [req.adminRegions]
  );
  res.json({ solveRequests: rows });
});

router.post('/solve-requests/:id/approve', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT sr.*, c.region_key FROM solve_requests sr JOIN cases c ON c.id = sr.case_id WHERE sr.id = $1`,
    [req.params.id]
  );
  const requestRow = rows[0];
  if (!requestRow || requestRow.status !== 'pending') return res.status(404).json({ error: 'Solve request not found' });
  if (!req.user.is_superadmin && !(await isRegionAdmin(req.user.id, requestRow.region_key))) {
    return res.status(403).json({ error: 'Not an admin for this region' });
  }
  const { rows: updated } = await pool.query(
    `UPDATE solve_requests SET status = 'approved', reviewed_by = $1, review_note = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
    [req.user.id, req.body?.note || '', req.params.id]
  );
  await pool.query('UPDATE cases SET solved_at = NOW() WHERE id = $1', [requestRow.case_id]);
  res.json({ solveRequest: updated[0] });
});

router.post('/solve-requests/:id/reject', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT sr.*, c.region_key FROM solve_requests sr JOIN cases c ON c.id = sr.case_id WHERE sr.id = $1`,
    [req.params.id]
  );
  const requestRow = rows[0];
  if (!requestRow || requestRow.status !== 'pending') return res.status(404).json({ error: 'Solve request not found' });
  if (!req.user.is_superadmin && !(await isRegionAdmin(req.user.id, requestRow.region_key))) {
    return res.status(403).json({ error: 'Not an admin for this region' });
  }
  const { rows: updated } = await pool.query(
    `UPDATE solve_requests SET status = 'rejected', reviewed_by = $1, review_note = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
    [req.user.id, req.body?.note || '', req.params.id]
  );
  res.json({ solveRequest: updated[0] });
});

// --- Superadmin: manage who administers which region ---

router.get('/region-admins', async (req, res) => {
  if (!req.user.is_superadmin) return res.status(403).json({ error: 'Superadmin access required' });
  const { rows } = await pool.query(
    `SELECT ra.id, ra.region_key, r.name AS region_name, u.id AS user_id, u.username
     FROM region_admins ra JOIN regions r ON r.key = ra.region_key JOIN users u ON u.id = ra.user_id
     ORDER BY r.sort_order`
  );
  res.json({ admins: rows });
});

router.post('/region-admins', async (req, res) => {
  if (!req.user.is_superadmin) return res.status(403).json({ error: 'Superadmin access required' });
  const { username, region_key } = req.body || {};
  const { rows: userRows } = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
  if (!userRows[0]) return res.status(404).json({ error: 'User not found' });
  const { rows: regionRows } = await pool.query('SELECT key FROM regions WHERE key = $1', [region_key]);
  if (!regionRows[0]) return res.status(400).json({ error: 'Unknown region' });
  await pool.query(
    'INSERT INTO region_admins (user_id, region_key) VALUES ($1, $2) ON CONFLICT (user_id, region_key) DO NOTHING',
    [userRows[0].id, region_key]
  );
  res.status(201).json({ ok: true });
});

router.delete('/region-admins/:id', async (req, res) => {
  if (!req.user.is_superadmin) return res.status(403).json({ error: 'Superadmin access required' });
  await pool.query('DELETE FROM region_admins WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
