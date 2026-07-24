const express = require('express');
const { db } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');
const { getOrCreateDm, isCaseMember } = require('../lib/chat');

const router = express.Router();

// List this user's DM conversations, most recently active first.
router.get('/dm', requireAuth, (req, res) => {
  const conversations = db
    .prepare(
      `SELECT dc.id,
              CASE WHEN dc.user_a = ? THEN dc.user_b ELSE dc.user_a END AS other_id,
              u.username AS other_username,
              (SELECT body FROM messages WHERE scope = 'dm' AND scope_id = dc.id ORDER BY created_at DESC LIMIT 1) AS last_message,
              (SELECT created_at FROM messages WHERE scope = 'dm' AND scope_id = dc.id ORDER BY created_at DESC LIMIT 1) AS last_message_at
       FROM dm_conversations dc
       JOIN users u ON u.id = CASE WHEN dc.user_a = ? THEN dc.user_b ELSE dc.user_a END
       WHERE dc.user_a = ? OR dc.user_b = ?
       ORDER BY last_message_at IS NULL, last_message_at DESC`
    )
    .all(req.user.id, req.user.id, req.user.id, req.user.id);
  res.json({ conversations });
});

// Get (creating if needed) the DM thread with another user, plus history.
router.get('/dm/:userId', requireAuth, (req, res) => {
  const otherId = Number(req.params.userId);
  if (otherId === req.user.id) return res.status(400).json({ error: "Can't DM yourself" });
  const other = db.prepare('SELECT id, username FROM users WHERE id = ?').get(otherId);
  if (!other) return res.status(404).json({ error: 'User not found' });

  const convo = getOrCreateDm(req.user.id, otherId);
  const messages = db
    .prepare(
      `SELECT m.id, m.body, m.created_at, u.id AS sender_id, u.username AS sender_username
       FROM messages m JOIN users u ON u.id = m.sender_id
       WHERE m.scope = 'dm' AND m.scope_id = ? ORDER BY m.created_at ASC`
    )
    .all(convo.id);

  res.json({ conversationId: convo.id, otherUser: other, messages });
});

// Group chat history for a case's hunt. Members-only.
router.get('/case/:caseId', requireAuth, (req, res) => {
  const caseRow = db.prepare('SELECT id FROM cases WHERE id = ?').get(req.params.caseId);
  if (!caseRow) return res.status(404).json({ error: 'Case not found' });
  if (!isCaseMember(req.params.caseId, req.user.id)) {
    return res.status(403).json({ error: 'Join the hunt to view its chat' });
  }
  const messages = db
    .prepare(
      `SELECT m.id, m.body, m.created_at, u.id AS sender_id, u.username AS sender_username
       FROM messages m JOIN users u ON u.id = m.sender_id
       WHERE m.scope = 'case' AND m.scope_id = ? ORDER BY m.created_at ASC`
    )
    .all(req.params.caseId);
  res.json({ messages });
});

module.exports = router;
