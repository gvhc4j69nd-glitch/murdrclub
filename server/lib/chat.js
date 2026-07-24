const { db } = require('../db/schema');

function getOrCreateDm(userIdA, userIdB) {
  const a = Math.min(userIdA, userIdB);
  const b = Math.max(userIdA, userIdB);
  let convo = db.prepare('SELECT * FROM dm_conversations WHERE user_a = ? AND user_b = ?').get(a, b);
  if (!convo) {
    const result = db.prepare('INSERT INTO dm_conversations (user_a, user_b) VALUES (?, ?)').run(a, b);
    convo = db.prepare('SELECT * FROM dm_conversations WHERE id = ?').get(result.lastInsertRowid);
  }
  return convo;
}

function isCaseMember(caseId, userId) {
  return !!db.prepare('SELECT 1 FROM case_members WHERE case_id = ? AND user_id = ?').get(caseId, userId);
}

function saveMessage(scope, scopeId, senderId, body) {
  const result = db
    .prepare('INSERT INTO messages (scope, scope_id, sender_id, body) VALUES (?, ?, ?, ?)')
    .run(scope, scopeId, senderId, body);
  return db
    .prepare(
      `SELECT m.id, m.scope, m.scope_id, m.body, m.created_at, u.id AS sender_id, u.username AS sender_username
       FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?`
    )
    .get(result.lastInsertRowid);
}

module.exports = { getOrCreateDm, isCaseMember, saveMessage };
