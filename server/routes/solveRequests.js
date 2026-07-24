const express = require('express');
const { pool } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');
const { isCaseMember } = require('../lib/chat');

const router = express.Router();

// Propose that a case has been solved. Must be on the hunt; case must still be
// open; only one pending request per case at a time (enforced by a partial
// unique index — 23505 below).
router.post('/cases/:id/solve-requests', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT id, status, solved_at FROM cases WHERE id = $1', [req.params.id]);
  const caseRow = rows[0];
  if (!caseRow || caseRow.status !== 'approved') return res.status(404).json({ error: 'Case not found' });
  if (caseRow.solved_at) return res.status(400).json({ error: 'Case is already closed' });
  if (!(await isCaseMember(req.params.id, req.user.id))) {
    return res.status(403).json({ error: 'Join the hunt before proposing this case is solved' });
  }
  const note = req.body?.note?.trim();
  if (!note) return res.status(400).json({ error: 'Explain why you believe this case is solved' });

  try {
    const { rows: inserted } = await pool.query(
      `INSERT INTO solve_requests (case_id, requested_by, note) VALUES ($1, $2, $3) RETURNING *`,
      [req.params.id, req.user.id, note]
    );
    res.status(201).json({ solveRequest: inserted[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A solve request for this case is already pending review' });
    }
    throw err;
  }
});

module.exports = router;
