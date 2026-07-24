const express = require('express');
const { pool } = require('../db/schema');

const router = express.Router();

// Member ranking: driven by how the club values a member's contributions
// (average rating from fellow hunters, weighted by how many contributions
// they've made so one 5-star post can't outrank a sustained track record).
const RANKING_SELECT = `
  SELECT u.id, u.username, u.bio, u.created_at,
         COUNT(DISTINCT ct.id)::int AS contribution_count,
         COUNT(DISTINCT cm.case_id)::int AS cases_joined,
         ROUND(COALESCE(AVG(r.rating), 0)::numeric, 2)::float8 AS avg_rating,
         COUNT(r.id)::int AS rating_count,
         ROUND((COALESCE(AVG(r.rating), 0) * (1 - 1.0 / (1.0 + COUNT(DISTINCT ct.id))))::numeric, 2)::float8 AS score
  FROM users u
  LEFT JOIN contributions ct ON ct.user_id = u.id
  LEFT JOIN contribution_ratings r ON r.contribution_id = ct.id
  LEFT JOIN case_members cm ON cm.user_id = u.id
  GROUP BY u.id
  ORDER BY score DESC, contribution_count DESC
`;

router.get('/', async (req, res) => {
  const { rows } = await pool.query(RANKING_SELECT);
  res.json({ members: rows });
});

router.get('/:username', async (req, res) => {
  const { rows: userRows } = await pool.query(
    'SELECT id, username, bio, created_at, is_superadmin FROM users WHERE username = $1',
    [req.params.username]
  );
  const user = userRows[0];
  if (!user) return res.status(404).json({ error: 'Member not found' });

  const { rows: statsRows } = await pool.query(
    `SELECT COUNT(DISTINCT ct.id)::int AS contribution_count,
            ROUND(COALESCE(AVG(r.rating), 0)::numeric, 2)::float8 AS avg_rating,
            COUNT(r.id)::int AS rating_count
     FROM users u
     LEFT JOIN contributions ct ON ct.user_id = u.id
     LEFT JOIN contribution_ratings r ON r.contribution_id = ct.id
     WHERE u.id = $1`,
    [user.id]
  );

  const { rows: casesJoined } = await pool.query(
    `SELECT c.id, c.title, c.region_key FROM case_members cm
     JOIN cases c ON c.id = cm.case_id WHERE cm.user_id = $1 ORDER BY cm.joined_at DESC`,
    [user.id]
  );

  const { rows: regionAdminOf } = await pool.query(
    `SELECT r.key, r.name FROM region_admins ra JOIN regions r ON r.key = ra.region_key WHERE ra.user_id = $1`,
    [user.id]
  );

  const { rows: rankRows } = await pool.query(
    `SELECT id, rank FROM (
       SELECT id, (ROW_NUMBER() OVER (ORDER BY score DESC))::int AS rank FROM (${RANKING_SELECT}) ranked
     ) t WHERE id = $1`,
    [user.id]
  );

  res.json({
    member: {
      ...user,
      ...statsRows[0],
      cases_joined: casesJoined,
      region_admin_of: regionAdminOf,
      rank: rankRows[0]?.rank ?? null,
    },
  });
});

module.exports = router;
