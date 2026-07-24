const { pool } = require('../db/schema');

async function getOrCreateDm(userIdA, userIdB) {
  const a = Math.min(userIdA, userIdB);
  const b = Math.max(userIdA, userIdB);

  const existing = await pool.query('SELECT * FROM dm_conversations WHERE user_a = $1 AND user_b = $2', [a, b]);
  if (existing.rows[0]) return existing.rows[0];

  try {
    const { rows } = await pool.query(
      'INSERT INTO dm_conversations (user_a, user_b) VALUES ($1, $2) RETURNING *',
      [a, b]
    );
    return rows[0];
  } catch (err) {
    // Two concurrent requests raced to create the same pair — fetch the winner.
    if (err.code === '23505') {
      const { rows } = await pool.query('SELECT * FROM dm_conversations WHERE user_a = $1 AND user_b = $2', [a, b]);
      return rows[0];
    }
    throw err;
  }
}

async function isCaseMember(caseId, userId) {
  const { rows } = await pool.query('SELECT 1 FROM case_members WHERE case_id = $1 AND user_id = $2', [caseId, userId]);
  return rows.length > 0;
}

async function saveMessage(scope, scopeId, senderId, body) {
  const { rows: inserted } = await pool.query(
    'INSERT INTO messages (scope, scope_id, sender_id, body) VALUES ($1, $2, $3, $4) RETURNING id',
    [scope, scopeId, senderId, body]
  );
  const { rows } = await pool.query(
    `SELECT m.id, m.scope, m.scope_id, m.body, m.created_at, u.id AS sender_id, u.username AS sender_username
     FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = $1`,
    [inserted[0].id]
  );
  return rows[0];
}

module.exports = { getOrCreateDm, isCaseMember, saveMessage };
