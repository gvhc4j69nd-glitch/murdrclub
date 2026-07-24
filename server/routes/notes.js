const express = require('express');
const { pool } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Personal, private per-case notes — visible only to the author, regardless
// of case membership or whether the case is closed.
router.post('/cases/:id/notes', requireAuth, async (req, res) => {
  const { rows: caseRows } = await pool.query('SELECT id FROM cases WHERE id = $1', [req.params.id]);
  if (!caseRows[0]) return res.status(404).json({ error: 'Case not found' });

  const body = req.body?.body ?? '';
  const { rows } = await pool.query(
    `INSERT INTO case_notes (case_id, user_id, body)
     VALUES ($1, $2, $3)
     ON CONFLICT (case_id, user_id) DO UPDATE SET body = excluded.body, updated_at = NOW()
     RETURNING body, updated_at`,
    [req.params.id, req.user.id, body]
  );
  res.json({ note: rows[0] });
});

module.exports = router;
