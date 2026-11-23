'use strict';

/**
 * Storage. Two backends with the same async interface:
 *
 *   Postgres  (production): every request reads and locks the club's row,
 *             changes it, and writes it back in one transaction. Nothing is
 *             cached in memory, so more than one server can run at once.
 *   File      (local development without a database): everything in memory,
 *             saved to data/murdrclub.json shortly after each change.
 *
 * A club is stored whole, as the JSON object the rules engine works on, with
 * a few columns copied out of it for lookups. Tables are prefixed mc_ so they
 * cannot collide with anything else in the same database.
 *
 * Interface:
 *   init()  close()
 *   findUserByName(lower)  getUser(id)  insertUser(user) → false if the name is taken
 *   insertSession(key, userId, createdAt)  getSession(key)  deleteSession(key)
 *   insertClub(club) → false if the code is taken
 *   clubIdByCode(code)
 *   withClub(id, fn, { skipLocked })  run fn(club) with the club locked; saves it if fn changed it
 *   clubsForUser(userId)  invitationsFor(userId)  openClubs(limit)  dueClubIds(now)
 */

const fs = require('fs');
const path = require('path');

const MAX_PLAYERS = 25;

// ---------------------------------------------------------------- Postgres

const SCHEMA = `
CREATE TABLE IF NOT EXISTS mc_users (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  name_lower  text NOT NULL UNIQUE,
  pass        text NOT NULL,
  created_at  bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS mc_sessions (
  key         text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES mc_users(id) ON DELETE CASCADE,
  created_at  bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS mc_clubs (
  id             text PRIMARY KEY,
  code           text NOT NULL UNIQUE,
  status         text NOT NULL,
  visibility     text NOT NULL,
  phase_ends_at  bigint,
  created_at     bigint NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  data           jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS mc_clubs_due ON mc_clubs (phase_ends_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS mc_clubs_open ON mc_clubs (visibility, status);
CREATE INDEX IF NOT EXISTS mc_clubs_players ON mc_clubs USING gin ((data->'players') jsonb_path_ops);
CREATE INDEX IF NOT EXISTS mc_clubs_invites ON mc_clubs USING gin ((data->'invites') jsonb_path_ops);
`;

const userFromRow = (r) => r && { id: r.id, name: r.name, nameLower: r.name_lower, pass: r.pass, createdAt: Number(r.created_at) };
const isUniqueViolation = (err) => err && err.code === '23505';
const clubColumns = (c) => [c.id, c.code, c.status, c.visibility, c.phaseEndsAt ?? null, c.createdAt, JSON.stringify(c)];

function createPgStore(pool) {
  return {
    kind: 'postgres',

    async init() {
      const client = await pool.connect();
      try {
        // One server at a time creates the tables, in case several start together.
        await client.query('SELECT pg_advisory_lock(727115)');
        await client.query(SCHEMA);
      } finally {
        await client.query('SELECT pg_advisory_unlock(727115)').catch(() => {});
        client.release();
      }
    },
    close: () => pool.end(),

    async findUserByName(lower) {
      const { rows } = await pool.query('SELECT * FROM mc_users WHERE name_lower = $1', [lower]);
      return userFromRow(rows[0]) || null;
    },
    async getUser(id) {
      const { rows } = await pool.query('SELECT * FROM mc_users WHERE id = $1', [id]);
      return userFromRow(rows[0]) || null;
    },
    async insertUser(u) {
      try {
        await pool.query('INSERT INTO mc_users (id, name, name_lower, pass, created_at) VALUES ($1, $2, $3, $4, $5)',
          [u.id, u.name, u.nameLower, u.pass, u.createdAt]);
        return true;
      } catch (err) {
        if (isUniqueViolation(err)) return false;
        throw err;
      }
    },

    async insertSession(key, userId, createdAt) {
      await pool.query('INSERT INTO mc_sessions (key, user_id, created_at) VALUES ($1, $2, $3)', [key, userId, createdAt]);
    },
    async getSession(key) {
      const { rows } = await pool.query('SELECT user_id, created_at FROM mc_sessions WHERE key = $1', [key]);
      return rows[0] ? { userId: rows[0].user_id, createdAt: Number(rows[0].created_at) } : null;
    },
    async deleteSession(key) {
      await pool.query('DELETE FROM mc_sessions WHERE key = $1', [key]);
    },

    async insertClub(club) {
      try {
        await pool.query(`INSERT INTO mc_clubs (id, code, status, visibility, phase_ends_at, created_at, data)
          VALUES ($1, $2, $3, $4, $5, $6, $7)`, clubColumns(club));
        return true;
      } catch (err) {
        if (isUniqueViolation(err)) return false;
        throw err;
      }
    },
    async clubIdByCode(code) {
      const { rows } = await pool.query('SELECT id FROM mc_clubs WHERE code = $1', [code]);
      return rows[0] ? rows[0].id : null;
    },

    async withClub(id, fn, { skipLocked = false } = {}) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(`SELECT data FROM mc_clubs WHERE id = $1 FOR UPDATE${skipLocked ? ' SKIP LOCKED' : ''}`, [id]);
        const club = rows[0] ? rows[0].data : null;
        const before = club && JSON.stringify(club);
        const result = await fn(club);
        if (club && JSON.stringify(club) !== before) {
          await client.query(`UPDATE mc_clubs SET status = $3, visibility = $4, phase_ends_at = $5, data = $7, updated_at = now()
            WHERE id = $1 AND code = $2 AND created_at = $6`, clubColumns(club));
        }
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },

    async clubsForUser(userId) {
      const { rows } = await pool.query(`SELECT data FROM mc_clubs WHERE data->'players' @> $1::jsonb ORDER BY created_at DESC LIMIT 200`,
        [JSON.stringify([{ userId }])]);
      return rows.map((r) => r.data);
    },
    async invitationsFor(userId) {
      const { rows } = await pool.query(`SELECT data FROM mc_clubs WHERE status = 'lobby' AND data->'invites' @> $1::jsonb ORDER BY created_at DESC`,
        [JSON.stringify([{ userId }])]);
      return rows.map((r) => r.data);
    },
    async openClubs(limit = 50) {
      const { rows } = await pool.query(`SELECT data FROM mc_clubs WHERE visibility = 'public' AND status = 'lobby'
        AND jsonb_array_length(data->'players') < $1 ORDER BY jsonb_array_length(data->'players') DESC, created_at DESC LIMIT $2`,
      [MAX_PLAYERS, limit]);
      return rows.map((r) => r.data);
    },
    async dueClubIds(now) {
      const { rows } = await pool.query(`SELECT id FROM mc_clubs WHERE status = 'active' AND phase_ends_at <= $1 ORDER BY phase_ends_at LIMIT 100`, [now]);
      return rows.map((r) => r.id);
    },
  };
}

// ---------------------------------------------------------------- file

function createFileStore(dataDir) {
  const file = dataDir ? path.join(dataDir, 'murdrclub.json') : null;
  let data = { users: {}, sessions: {}, clubs: {} };
  if (file && fs.existsSync(file)) data = { ...data, ...JSON.parse(fs.readFileSync(file, 'utf8')) };

  let timer = null;
  function flush() {
    timer = null;
    if (!file) return;
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file); // atomic: a crash never leaves a half-written file
  }
  const save = () => { if (!timer) timer = setTimeout(flush, 250); };
  // Hand out copies so callers can't change stored state outside withClub.
  const copy = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
  const isMember = (c, userId) => c.players.some((p) => p.userId === userId);

  // withClub runs one at a time, like Postgres row locks.
  let queue = Promise.resolve();

  return {
    kind: 'file',
    file,
    async init() {},
    async close() { if (timer) clearTimeout(timer); flush(); },

    async findUserByName(lower) { return copy(Object.values(data.users).find((u) => u.nameLower === lower) || null); },
    async getUser(id) { return copy(data.users[id] || null); },
    async insertUser(u) {
      if (Object.values(data.users).some((x) => x.nameLower === u.nameLower)) return false;
      data.users[u.id] = copy(u);
      save();
      return true;
    },

    async insertSession(key, userId, createdAt) { data.sessions[key] = { userId, createdAt }; save(); },
    async getSession(key) { return copy(data.sessions[key] || null); },
    async deleteSession(key) { delete data.sessions[key]; save(); },

    async insertClub(club) {
      if (Object.values(data.clubs).some((c) => c.code === club.code)) return false;
      data.clubs[club.id] = copy(club);
      save();
      return true;
    },
    async clubIdByCode(code) { const c = Object.values(data.clubs).find((x) => x.code === code); return c ? c.id : null; },

    withClub(id, fn) {
      const run = queue.then(async () => {
        const club = data.clubs[id] ? copy(data.clubs[id]) : null;
        const before = club && JSON.stringify(club);
        const result = await fn(club);
        if (club && JSON.stringify(club) !== before) { data.clubs[id] = club; save(); }
        return result;
      });
      queue = run.catch(() => {});
      return run;
    },

    async clubsForUser(userId) {
      return copy(Object.values(data.clubs).filter((c) => isMember(c, userId)).sort((a, b) => b.createdAt - a.createdAt));
    },
    async invitationsFor(userId) {
      return copy(Object.values(data.clubs).filter((c) => c.status === 'lobby' && (c.invites || []).some((i) => i.userId === userId)));
    },
    async openClubs(limit = 50) {
      return copy(Object.values(data.clubs)
        .filter((c) => c.visibility === 'public' && c.status === 'lobby' && c.players.length < MAX_PLAYERS)
        .sort((a, b) => b.players.length - a.players.length || b.createdAt - a.createdAt)
        .slice(0, limit));
    },
    async dueClubIds(now) {
      return Object.values(data.clubs).filter((c) => c.status === 'active' && c.phaseEndsAt <= now).map((c) => c.id);
    },
  };
}

module.exports = { createPgStore, createFileStore, SCHEMA };
