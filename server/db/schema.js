const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
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
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_club BOOLEAN NOT NULL DEFAULT false`);

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
  await pool.query(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS solved_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS last_researched_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS research_miss_streak INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS map_address TEXT DEFAULT ''`);

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
  await pool.query(`ALTER TABLE contributions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'visible'`);

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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS solve_requests (
      id SERIAL PRIMARY KEY,
      case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      requested_by INTEGER NOT NULL REFERENCES users(id),
      note TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      reviewed_by INTEGER REFERENCES users(id),
      review_note TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS case_notes (
      id SERIAL PRIMARY KEY,
      case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Notes used to be a single upserted row per (case, user); now each save
  // is its own timestamped entry, so the old one-per-pair constraint has to go.
  await pool.query(`ALTER TABLE case_notes DROP CONSTRAINT IF EXISTS case_notes_case_id_user_id_key`);
  await pool.query(`ALTER TABLE case_notes DROP COLUMN IF EXISTS updated_at`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_case_notes_case_user ON case_notes(case_id, user_id, created_at DESC)`);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_cases_region_status ON cases(region_key, status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_contributions_case ON contributions(case_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ratings_contribution ON contribution_ratings(contribution_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_scope ON messages(scope, scope_id, created_at)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_case_members_case ON case_members(case_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_solve_requests_case ON solve_requests(case_id)`);
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_solve_requests_one_pending ON solve_requests(case_id) WHERE status = 'pending'`
  );

  for (const [i, r] of REGIONS.entries()) {
    await pool.query(
      `INSERT INTO regions (key, name, sort_order) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING`,
      [r.key, r.name, i]
    );
  }

  await pool.query(
    `INSERT INTO users (username, email, password_hash, is_club)
     VALUES ('MURD''R CLUB', 'club@murdrclub.internal', $1, true)
     ON CONFLICT (username) DO NOTHING`,
    [bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10)]
  );
}

module.exports = { pool, init };
