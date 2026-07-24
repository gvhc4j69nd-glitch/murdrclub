const express = require('express');
const { pool } = require('../db/schema');
const { requireAuth, optionalAuth } = require('../middleware/auth');

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

router.get('/', async (req, res) => {
  const { region } = req.query;
  const { rows } = region
    ? await pool.query(
        `SELECT c.id, c.title, c.victim_name, c.region_key, c.location, c.date_occurred, c.created_at,
                (SELECT COUNT(*) FROM case_members m WHERE m.case_id = c.id)::int AS member_count,
                (SELECT COUNT(*) FROM contributions ct WHERE ct.case_id = c.id)::int AS contribution_count
         FROM cases c
         WHERE c.status = 'approved' AND c.region_key = $1
         ORDER BY member_count DESC, c.created_at DESC`,
        [region]
      )
    : await pool.query(
        `SELECT c.id, c.title, c.victim_name, c.region_key, c.location, c.date_occurred, c.created_at,
                (SELECT COUNT(*) FROM case_members m WHERE m.case_id = c.id)::int AS member_count,
                (SELECT COUNT(*) FROM contributions ct WHERE ct.case_id = c.id)::int AS contribution_count
         FROM cases c
         WHERE c.status = 'approved'
         ORDER BY member_count DESC, c.created_at DESC`
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

  const { rows: contributions } = await pool.query(
    `SELECT ct.id, ct.body, ct.link_url, ct.photo_url, ct.video_url, ct.created_at,
            u.id AS user_id, u.username,
            ROUND(AVG(r.rating)::numeric, 2)::float8 AS avg_rating,
            COUNT(r.id)::int AS rating_count
     FROM contributions ct
     JOIN users u ON u.id = ct.user_id
     LEFT JOIN contribution_ratings r ON r.contribution_id = ct.id
     WHERE ct.case_id = $1
     GROUP BY ct.id, u.id
     ORDER BY ct.created_at DESC`,
    [req.params.id]
  );

  let isMember = false;
  if (req.user) {
    const { rows } = await pool.query('SELECT 1 FROM case_members WHERE case_id = $1 AND user_id = $2', [
      req.params.id,
      req.user.id,
    ]);
    isMember = rows.length > 0;
  }

  res.json({ case: caseRow, members, contributions, isMember });
});

router.post('/', requireAuth, async (req, res) => {
  const { title, victim_name, region_key, location, date_occurred, summary } = req.body || {};
  if (!title || !region_key || !summary) {
    return res.status(400).json({ error: 'Title, region, and summary are required' });
  }
  const { rows: regionRows } = await pool.query('SELECT key FROM regions WHERE key = $1', [region_key]);
  if (!regionRows[0]) return res.status(400).json({ error: 'Unknown region' });

  const { rows } = await pool.query(
    `INSERT INTO cases (title, victim_name, region_key, location, date_occurred, summary, submitted_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [title, victim_name || '', region_key, location || '', date_occurred || '', summary, req.user.id]
  );
  const caseId = rows[0].id;

  await pool.query('INSERT INTO case_members (case_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
    caseId,
    req.user.id,
  ]);

  res.status(201).json({ case: await caseWithCounts(caseId) });
});

router.post('/:id/join', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT id, status FROM cases WHERE id = $1', [req.params.id]);
  const caseRow = rows[0];
  if (!caseRow || caseRow.status !== 'approved') return res.status(404).json({ error: 'Case not found' });
  await pool.query('INSERT INTO case_members (case_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
    req.params.id,
    req.user.id,
  ]);
  res.json({ joined: true });
});

router.delete('/:id/join', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM case_members WHERE case_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  res.json({ joined: false });
});

module.exports = router;
