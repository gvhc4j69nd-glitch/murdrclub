const { Pool } = require('pg');
const { REGIONS } = require('./regions');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      bio TEXT DEFAULT '',
      is_superadmin BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS regions (
      key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS region_admins (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      region_key TEXT NOT NULL REFERENCES regions(key) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, region_key)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cases (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      victim_name TEXT DEFAULT '',
      region_key TEXT NOT NULL REFERENCES regions(key),
      location TEXT DEFAULT '',
      date_occurred TEXT DEFAULT '',
      summary TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      submitted_by INTEGER NOT NULL REFERENCES users(id),
      reviewed_by INTEGER REFERENCES users(id),
      review_note TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS case_members (
      id SERIAL PRIMARY KEY,
      case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(case_id, user_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS contributions (
      id SERIAL PRIMARY KEY,
      case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT DEFAULT '',
      link_url TEXT DEFAULT '',
      photo_url TEXT DEFAULT '',
      video_url TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS contribution_ratings (
      id SERIAL PRIMARY KEY,
      contribution_id INTEGER NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
      rater_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(contribution_id, rater_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dm_conversations (
      id SERIAL PRIMARY KEY,
      user_a INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_b INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_a, user_b)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      scope TEXT NOT NULL,
      scope_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_cases_region_status ON cases(region_key, status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_contributions_case ON contributions(case_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ratings_contribution ON contribution_ratings(contribution_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_scope ON messages(scope, scope_id, created_at)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_case_members_case ON case_members(case_id)`);

  for (const [i, r] of REGIONS.entries()) {
    await pool.query(
      `INSERT INTO regions (key, name, sort_order) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING`,
      [r.key, r.name, i]
    );
  }
}

module.exports = { pool, init };
