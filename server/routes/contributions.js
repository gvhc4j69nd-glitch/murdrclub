const express = require('express');
const { db } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function isCaseMember(caseId, userId) {
  return !!db.prepare('SELECT 1 FROM case_members WHERE case_id = ? AND user_id = ?').get(caseId, userId);
}

// Add information (text, link, photo, video) to a case. Must have joined the hunt.
router.post('/cases/:id/contributions', requireAuth, (req, res) => {
  const caseRow = db.prepare('SELECT id, status FROM cases WHERE id = ?').get(req.params.id);
  if (!caseRow || caseRow.status !== 'approved') return res.status(404).json({ error: 'Case not found' });
  if (!isCaseMember(req.params.id, req.user.id)) {
    return res.status(403).json({ error: 'Join the hunt before adding information' });
  }

  const { body, link_url, photo_url, video_url } = req.body || {};
  if (!body?.trim() && !link_url?.trim() && !photo_url?.trim() && !video_url?.trim()) {
    return res.status(400).json({ error: 'Add some text, a link, a photo, or a video' });
  }

  const result = db
    .prepare(
      `INSERT INTO contributions (case_id, user_id, body, link_url, photo_url, video_url)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(req.params.id, req.user.id, body || '', link_url || '', photo_url || '', video_url || '');

  const contribution = db
    .prepare(
      `SELECT ct.id, ct.body, ct.link_url, ct.photo_url, ct.video_url, ct.created_at,
              u.id AS user_id, u.username
       FROM contributions ct JOIN users u ON u.id = ct.user_id WHERE ct.id = ?`
    )
    .get(result.lastInsertRowid);

  res.status(201).json({ contribution: { ...contribution, avg_rating: null, rating_count: 0 } });
});

// Rate a contribution 1-5. Only fellow hunt members can vouch for it, not the author.
router.post('/contributions/:id/rate', requireAuth, (req, res) => {
  const rating = Number(req.body?.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Rating must be an integer 1-5' });
  }

  const contribution = db.prepare('SELECT id, case_id, user_id FROM contributions WHERE id = ?').get(req.params.id);
  if (!contribution) return res.status(404).json({ error: 'Contribution not found' });
  if (contribution.user_id === req.user.id) return res.status(400).json({ error: "You can't rate your own contribution" });
  if (!isCaseMember(contribution.case_id, req.user.id)) {
    return res.status(403).json({ error: 'Join the hunt before rating contributions' });
  }

  db.prepare(
    `INSERT INTO contribution_ratings (contribution_id, rater_id, rating)
     VALUES (?, ?, ?)
     ON CONFLICT(contribution_id, rater_id) DO UPDATE SET rating = excluded.rating`
  ).run(req.params.id, req.user.id, rating);

  const stats = db
    .prepare('SELECT ROUND(AVG(rating), 2) AS avg_rating, COUNT(*) AS rating_count FROM contribution_ratings WHERE contribution_id = ?')
    .get(req.params.id);

  res.json({ avg_rating: stats.avg_rating, rating_count: stats.rating_count, your_rating: rating });
});

module.exports = router;
