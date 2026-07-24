const express = require('express');
const { pool } = require('../db/schema');

const router = express.Router();

router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT r.key, r.name,
            COUNT(c.id)::int AS case_count
     FROM regions r
     LEFT JOIN cases c ON c.region_key = r.key AND c.status = 'approved'
     GROUP BY r.key, r.name, r.sort_order
     ORDER BY r.sort_order`
  );
  res.json({ regions: rows });
});

router.get('/:key', async (req, res) => {
  const { rows: regionRows } = await pool.query('SELECT key, name FROM regions WHERE key = $1', [req.params.key]);
  const region = regionRows[0];
  if (!region) return res.status(404).json({ error: 'Region not found' });

  const { rows: cases } = await pool.query(
    `SELECT c.id, c.title, c.victim_name, c.location, c.date_occurred, c.summary, c.created_at,
            (SELECT COUNT(*) FROM case_members m WHERE m.case_id = c.id)::int AS member_count,
            (SELECT COUNT(*) FROM contributions ct WHERE ct.case_id = c.id)::int AS contribution_count
     FROM cases c
     WHERE c.region_key = $1 AND c.status = 'approved'
     ORDER BY member_count DESC, contribution_count DESC, c.created_at DESC`,
    [req.params.key]
  );

  res.json({ region, cases });
});

module.exports = router;
