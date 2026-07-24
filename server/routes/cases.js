const express = require('express');
const { pool } = require('../db/schema');
const { requireAuth, optionalAuth, isRegionAdmin } = require('../middleware/auth');

const router = express.Router();

async function caseWithCounts(caseId) {
  const { rows } = await pool.query(
    `SELECT c.*, u.username AS submitted_by_username,
            (SELECT COUNT(*) FROM case_members m WHERE m.case_id = c.id)::int AS member_count,
            (SELECT COUNT(*) FROM contributions ct WHERE ct.case_id = c.id)::int AS contribution_count
     FROM cases c
     JOIN users u ON u.id = c.submitted_by
     WHERE c.id = $1`,
    [caseId]
  );
  return rows[0];
}

const PAGE_SIZE = 20;

router.get('/', async (req, res) => {
  const { region } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const whereClause = region ? `WHERE c.status = 'approved' AND c.region_key = $1` : `WHERE c.status = 'approved'`;
  const whereParams = region ? [region] : [];

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM cases c ${whereClause}`,
    whereParams
  );
  const total = countRows[0].total;

  const { rows } = await pool.query(
    `SELECT c.id, c.title, c.victim_name, c.region_key, c.location, c.date_occurred, c.created_at,
            (SELECT COUNT(*) FROM case_members m WHERE m.case_id = c.id)::int AS member_count,
            (SELECT COUNT(*) FROM contributions ct WHERE ct.case_id = c.id)::int AS contribution_count
     FROM cases c
     ${whereClause}
     ORDER BY member_count DESC, c.created_at DESC
     LIMIT $${whereParams.length + 1} OFFSET $${whereParams.length + 2}`,
    [...whereParams, PAGE_SIZE, offset]
  );

  res.json({ cases: rows, page, pageSize: PAGE_SIZE, total, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)) });
});

// Full, unpaginated set for the homepage map — every active case needs a pin.
router.get('/pins', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, title, victim_name, region_key, location, map_address
     FROM cases WHERE status = 'approved'`
  );
  res.json({ cases: rows });
});

router.get('/:id', optionalAuth, async (req, res) => {
  const caseRow = await caseWithCounts(req.params.id);
  if (!caseRow) return res.status(404).json({ error: 'Case not found' });
  if (caseRow.status !== 'approved' && !(req.user && (req.user.is_superadmin || req.user.id === caseRow.submitted_by))) {
    return res.status(404).json({ error: 'Case not found' });
  }

  const { rows: members } = await pool.query(
    `SELECT u.id, u.username, cm.joined_at
     FROM case_members cm JOIN users u ON u.id = cm.user_id
     WHERE cm.case_id = $1 ORDER BY cm.joined_at ASC`,
    [req.params.id]
  );

  const canSeePending =
    !!req.user && (req.user.is_superadmin || (await isRegionAdmin(req.user.id, caseRow.region_key)));

  const { rows: contributions } = await pool.query(
    `SELECT ct.id, ct.body, ct.link_url, ct.photo_url, ct.video_url, ct.created_at, ct.status,
            u.id AS user_id, u.username, u.is_club,
            ROUND(AVG(r.rating)::numeric, 2)::float8 AS avg_rating,
            COUNT(r.id)::int AS rating_count
     FROM contributions ct
     JOIN users u ON u.id = ct.user_id
     LEFT JOIN contribution_ratings r ON r.contribution_id = ct.id
     WHERE ct.case_id = $1 AND ct.status != 'rejected' AND (ct.status = 'visible' OR $2)
     GROUP BY ct.id, u.id
     ORDER BY ct.created_at DESC`,
    [req.params.id, canSeePending]
  );

  let isMember = false;
  if (req.user) {
    const { rows } = await pool.query('SELECT 1 FROM case_members WHERE case_id = $1 AND user_id = $2', [
      req.params.id,
      req.user.id,
    ]);
    isMember = rows.length > 0;
  }

  const { rows: solveRequestRows } = await pool.query(
    `SELECT * FROM solve_requests WHERE case_id = $1 AND status = 'pending'`,
    [req.params.id]
  );

  let myNote = '';
  if (req.user) {
    const { rows: noteRows } = await pool.query(
      'SELECT body FROM case_notes WHERE case_id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    myNote = noteRows[0]?.body || '';
  }

  res.json({
    case: caseRow,
    members,
    contributions,
    isMember,
    solveRequest: solveRequestRows[0] || null,
    canModerate: canSeePending,
    myNote,
  });
});

router.post('/', requireAuth, async (req, res) => {
  const { title, victim_name, region_key, location, date_occurred, summary, map_address } = req.body || {};
  if (!title || !region_key || !summary) {
    return res.status(400).json({ error: 'Title, region, and summary are required' });
  }
  const { rows: regionRows } = await pool.query('SELECT key FROM regions WHERE key = $1', [region_key]);
  if (!regionRows[0]) return res.status(400).json({ error: 'Unknown region' });

  const { rows } = await pool.query(
    `INSERT INTO cases (title, victim_name, region_key, location, date_occurred, summary, submitted_by, map_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [title, victim_name || '', region_key, location || '', date_occurred || '', summary, req.user.id, map_address || '']
  );
  const caseId = rows[0].id;

  await pool.query('INSERT INTO case_members (case_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
    caseId,
    req.user.id,
  ]);

  res.status(201).json({ case: await caseWithCounts(caseId) });
});

router.post('/:id/join', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT id, status, solved_at FROM cases WHERE id = $1', [req.params.id]);
  const caseRow = rows[0];
  if (!caseRow || caseRow.status !== 'approved') return res.status(404).json({ error: 'Case not found' });
  if (caseRow.solved_at) return res.status(400).json({ error: 'Case is closed' });
  await pool.query('INSERT INTO case_members (case_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
    req.params.id,
    req.user.id,
  ]);
  res.json({ joined: true });
});

router.delete('/:id/join', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT solved_at FROM cases WHERE id = $1', [req.params.id]);
  if (rows[0]?.solved_at) return res.status(400).json({ error: 'Case is closed' });
  await pool.query('DELETE FROM case_members WHERE case_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  res.json({ joined: false });
});

module.exports = router;
