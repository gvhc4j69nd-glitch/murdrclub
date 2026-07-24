const express = require('express');
const { db } = require('../db/schema');

const router = express.Router();

router.get('/', (req, res) => {
  const regions = db
    .prepare(
      `SELECT r.key, r.name,
              COUNT(c.id) AS case_count
       FROM regions r
       LEFT JOIN cases c ON c.region_key = r.key AND c.status = 'approved'
       GROUP BY r.key
       ORDER BY r.sort_order`
    )
    .all();
  res.json({ regions });
});

router.get('/:key', (req, res) => {
  const region = db.prepare('SELECT key, name FROM regions WHERE key = ?').get(req.params.key);
  if (!region) return res.status(404).json({ error: 'Region not found' });

  const topCases = db
    .prepare(
      `SELECT c.id, c.title, c.victim_name, c.location, c.date_occurred, c.summary, c.created_at,
              (SELECT COUNT(*) FROM case_members m WHERE m.case_id = c.id) AS member_count,
              (SELECT COUNT(*) FROM contributions ct WHERE ct.case_id = c.id) AS contribution_count
       FROM cases c
       WHERE c.region_key = ? AND c.status = 'approved'
       ORDER BY member_count DESC, contribution_count DESC, c.created_at DESC`
    )
    .all(req.params.key);

  res.json({ region, cases: topCases });
});

module.exports = router;
