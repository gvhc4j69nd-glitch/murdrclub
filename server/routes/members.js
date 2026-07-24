const express = require('express');
const { db } = require('../db/schema');

const router = express.Router();

// Member ranking: driven by how the club values a member's contributions
// (average rating from fellow hunters, weighted by how many contributions
// they've made so one 5-star post can't outrank a sustained track record).
const RANKING_SELECT = `
  SELECT u.id, u.username, u.bio, u.created_at,
         COUNT(DISTINCT ct.id) AS contribution_count,
         COUNT(DISTINCT cm.case_id) AS cases_joined,
         ROUND(COALESCE(AVG(r.rating), 0), 2) AS avg_rating,
         COUNT(r.id) AS rating_count,
         ROUND(COALESCE(AVG(r.rating), 0) * (1 - 1 / (1.0 + COUNT(DISTINCT ct.id))), 2) AS score
  FROM users u
  LEFT JOIN contributions ct ON ct.user_id = u.id
  LEFT JOIN contribution_ratings r ON r.contribution_id = ct.id
  LEFT JOIN case_members cm ON cm.user_id = u.id
  GROUP BY u.id
  ORDER BY score DESC, contribution_count DESC
`;

router.get('/', (req, res) => {
  const members = db.prepare(RANKING_SELECT).all();
  res.json({ members });
});

router.get('/:username', (req, res) => {
  const user = db.prepare('SELECT id, username, bio, created_at, is_superadmin FROM users WHERE username = ?').get(req.params.username);
  if (!user) return res.status(404).json({ error: 'Member not found' });

  const stats = db
    .prepare(
      `SELECT COUNT(DISTINCT ct.id) AS contribution_count,
              ROUND(COALESCE(AVG(r.rating), 0), 2) AS avg_rating,
              COUNT(r.id) AS rating_count
       FROM users u
       LEFT JOIN contributions ct ON ct.user_id = u.id
       LEFT JOIN contribution_ratings r ON r.contribution_id = ct.id
       WHERE u.id = ?`
    )
    .get(user.id);

  const casesJoined = db
    .prepare(
      `SELECT c.id, c.title, c.region_key FROM case_members cm
       JOIN cases c ON c.id = cm.case_id WHERE cm.user_id = ? ORDER BY cm.joined_at DESC`
    )
    .all(user.id);

  const regionAdminOf = db
    .prepare(`SELECT r.key, r.name FROM region_admins ra JOIN regions r ON r.key = ra.region_key WHERE ra.user_id = ?`)
    .all(user.id);

  const rankRow = db.prepare(`
    SELECT rank FROM (
      SELECT id, ROW_NUMBER() OVER (ORDER BY score DESC) AS rank FROM (${RANKING_SELECT})
    ) WHERE id = ?
  `).get(user.id);

  res.json({
    member: { ...user, ...stats, cases_joined: casesJoined, region_admin_of: regionAdminOf, rank: rankRow?.rank || null },
  });
});

module.exports = router;
