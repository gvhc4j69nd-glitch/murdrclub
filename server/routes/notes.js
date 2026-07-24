const express = require('express');
const { pool } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Personal, private per-case notes — visible only to the author, regardless
// of case membership or whether the case is closed. Each save adds a new
// timestamped entry rather than overwriting a single note.
router.post('/cases/:id/notes', requireAuth, async (req, res) => {
  const { rows: caseRows } = await pool.query('SELECT id FROM cases WHERE id = $1', [req.params.id]);
  if (!caseRows[0]) return res.status(404).json({ error: 'Case not found' });

  const body = req.body?.body?.trim();
  if (!body) return res.status(400).json({ error: 'Note cannot be empty' });

  const { rows } = await pool.query(
    `INSERT INTO case_notes (case_id, user_id, body) VALUES ($1, $2, $3) RETURNING id, body, created_at`,
    [req.params.id, req.user.id, body]
  );
  res.status(201).json({ note: rows[0] });
});

module.exports = router;
