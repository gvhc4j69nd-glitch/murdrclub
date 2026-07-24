const path = require('path');
const Database = require('better-sqlite3');
const { REGIONS } = require('./regions');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'murdrclub.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      bio TEXT DEFAULT '',
      is_superadmin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS regions (
      key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS region_admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      region_key TEXT NOT NULL REFERENCES regions(key) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, region_key)
    );

    CREATE TABLE IF NOT EXISTS cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      victim_name TEXT DEFAULT '',
      region_key TEXT NOT NULL REFERENCES regions(key),
      location TEXT DEFAULT '',
      date_occurred TEXT DEFAULT '',
      summary TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
      submitted_by INTEGER NOT NULL REFERENCES users(id),
      reviewed_by INTEGER REFERENCES users(id),
      review_note TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS case_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(case_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS contributions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT DEFAULT '',
      link_url TEXT DEFAULT '',
      photo_url TEXT DEFAULT '',
      video_url TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS contribution_ratings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contribution_id INTEGER NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
      rater_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(contribution_id, rater_id)
    );

    CREATE TABLE IF NOT EXISTS dm_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_a INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_b INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_a, user_b)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL, -- 'dm' | 'case'
      scope_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_cases_region_status ON cases(region_key, status);
    CREATE INDEX IF NOT EXISTS idx_contributions_case ON contributions(case_id);
    CREATE INDEX IF NOT EXISTS idx_ratings_contribution ON contribution_ratings(contribution_id);
    CREATE INDEX IF NOT EXISTS idx_messages_scope ON messages(scope, scope_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_case_members_case ON case_members(case_id);
  `);

  const insertRegion = db.prepare(
    'INSERT OR IGNORE INTO regions (key, name, sort_order) VALUES (?, ?, ?)'
  );
  const seedRegions = db.transaction(() => {
    REGIONS.forEach((r, i) => insertRegion.run(r.key, r.name, i));
  });
  seedRegions();
}

module.exports = { db, init };
