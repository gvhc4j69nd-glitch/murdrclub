const express = require('express');
const { pool } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

async function isCaseMember(caseId, userId) {
  const { rows } = await pool.query('SELECT 1 FROM case_members WHERE case_id = $1 AND user_id = $2', [caseId, userId]);
  return rows.length > 0;
}

// Add information (text, link, photo, video) to a case. Must have joined the hunt.
router.post('/cases/:id/contributions', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT id, status FROM cases WHERE id = $1', [req.params.id]);
  const caseRow = rows[0];
  if (!caseRow || caseRow.status !== 'approved') return res.status(404).json({ error: 'Case not found' });
  if (!(await isCaseMember(req.params.id, req.user.id))) {
    return res.status(403).json({ error: 'Join the hunt before adding information' });
  }

  const { body, link_url, photo_url, video_url } = req.body || {};
  if (!body?.trim() && !link_url?.trim() && !photo_url?.trim() && !video_url?.trim()) {
    return res.status(400).json({ error: 'Add some text, a link, a photo, or a video' });
  }

  const { rows: inserted } = await pool.query(
    `INSERT INTO contributions (case_id, user_id, body, link_url, photo_url, video_url)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [req.params.id, req.user.id, body || '', link_url || '', photo_url || '', video_url || '']
  );

  const { rows: contribRows } = await pool.query(
    `SELECT ct.id, ct.body, ct.link_url, ct.photo_url, ct.video_url, ct.created_at,
            u.id AS user_id, u.username
     FROM contributions ct JOIN users u ON u.id = ct.user_id WHERE ct.id = $1`,
    [inserted[0].id]
  );

  res.status(201).json({ contribution: { ...contribRows[0], avg_rating: null, rating_count: 0 } });
});

// Rate a contribution 1-5. Only fellow hunt members can vouch for it, not the author.
router.post('/contributions/:id/rate', requireAuth, async (req, res) => {
  const rating = Number(req.body?.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Rating must be an integer 1-5' });
  }

  const { rows } = await pool.query('SELECT id, case_id, user_id FROM contributions WHERE id = $1', [req.params.id]);
  const contribution = rows[0];
  if (!contribution) return res.status(404).json({ error: 'Contribution not found' });
  if (contribution.user_id === req.user.id) return res.status(400).json({ error: "You can't rate your own contribution" });
  if (!(await isCaseMember(contribution.case_id, req.user.id))) {
    return res.status(403).json({ error: 'Join the hunt before rating contributions' });
  }

  await pool.query(
    `INSERT INTO contribution_ratings (contribution_id, rater_id, rating)
     VALUES ($1, $2, $3)
     ON CONFLICT (contribution_id, rater_id) DO UPDATE SET rating = excluded.rating`,
    [req.params.id, req.user.id, rating]
  );

  const { rows: statsRows } = await pool.query(
    `SELECT ROUND(AVG(rating)::numeric, 2)::float8 AS avg_rating, COUNT(*)::int AS rating_count
     FROM contribution_ratings WHERE contribution_id = $1`,
    [req.params.id]
  );

  res.json({ avg_rating: statsRows[0].avg_rating, rating_count: statsRows[0].rating_count, your_rating: rating });
});

module.exports = router;
