'use strict';

/**
 * MurdrClub web server (murdrclub.com).
 *
 * Serves the single-page app from public/ and a small JSON API under /api.
 * State lives in Postgres when DATABASE_URL is set (production), otherwise in
 * a local JSON file (development). A timer moves every running club to its
 * next phase when its deadline passes.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const game = require('./lib/game');
const auth = require('./lib/auth');
const { createPgStore, createFileStore } = require('./lib/store');
const db = require('./lib/db');

const PUBLIC_DIR = path.join(__dirname, 'public');
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json' };
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
};

// ---------------------------------------------------------------- http helpers

function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...headers });
  res.end(payload);
}

async function readJson(req, limit = 16 * 1024) {
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) return null;
    chunks.push(chunk);
  }
  if (!total) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return null; }
}

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  let file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return false;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    // Unknown paths without an extension get the app (it routes by hash).
    if (path.extname(rel)) return false;
    file = path.join(PUBLIC_DIR, 'index.html');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...SECURITY_HEADERS });
  fs.createReadStream(file).pipe(res);
  return true;
}

// ---------------------------------------------------------------- app

/** Where the file store saves: DATA_DIR, else a Railway volume, else ./data. */
function defaultDataDir() {
  return process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
}

/** Postgres if a database is configured, otherwise the local file store. */
async function openStore({ env = process.env, log = console } = {}) {
  const conn = db.connectionString(env);
  if (conn) {
    const pool = await db.connect(conn.url, { log });
    const store = createPgStore(pool);
    await store.init();
    log.log(`Storage: Postgres (from ${conn.source}).`);
    return store;
  }
  const store = createFileStore(defaultDataDir());
  log.log(`Storage: file ${store.file}. Set DATABASE_URL to use Postgres.`);
  if (env.RAILWAY_ENVIRONMENT && !env.RAILWAY_VOLUME_MOUNT_PATH && !env.DATA_DIR) {
    log.warn('WARNING: no database or volume is attached. Every account and game will be wiped on the next deploy. Add DATABASE_URL = ${{Postgres.DATABASE_URL}} to this service\'s variables.');
  }
  return store;
}

const cleanName = (raw) => String(raw || '').trim().replace(/\s+/g, ' ');

function createApp({ store, clock = () => Date.now(), rng = Math.random, tickMs = 2000, log = console }) {
  if (!store) throw new Error('createApp needs a store');
  const ctx = () => ({ now: clock(), rng });
  const newId = () => crypto.randomBytes(8).toString('base64url');
  const newCode = () => {
    let code = '';
    for (const b of crypto.randomBytes(6)) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
    return code;
  };

  // Move every club whose phase has ended. Clubs another server is already
  // handling are skipped (SKIP LOCKED) and picked up on the next run.
  let ticking = false;
  async function tickAll() {
    if (ticking) return;
    ticking = true;
    try {
      for (const id of await store.dueClubIds(clock())) {
        await store.withClub(id, (club) => { if (isCurrent(club) && club.status === 'active') game.tick(club, ctx()); }, { skipLocked: true });
      }
    } catch (err) {
      log.error('Phase timer failed:', err.message);
    } finally {
      ticking = false;
    }
  }
  const timer = tickMs ? setInterval(tickAll, tickMs) : null;
  if (timer) timer.unref();

  // Tables from before the card game have a different shape; they are left alone.
  const isCurrent = (t) => Boolean(t && t.kind === 'cards');

  function clubSummary(t, userId) {
    const me = game.find(t, userId);
    return {
      id: t.id, name: t.name, code: t.code, status: t.status, phase: t.phase, round: t.round, rounds: game.ROUNDS,
      players: t.players.length, alive: t.players.filter((p) => p.alive).length,
      isHost: t.hostId === userId, myAlive: me ? me.alive : null,
      myTurn: Boolean(me && t.status === 'active' && game.currentTurn(t) === me),
      won: t.status === 'ended' ? t.winner === userId : null,
      mode: t.mode, visibility: t.visibility,
    };
  }

  const hostName = (t) => (game.find(t, t.hostId) || {}).name || '';
  const lobbyCard = (t) => ({ id: t.id, name: t.name, host: hostName(t), players: t.players.length, seats: game.SEATS, mode: t.mode });

  async function startSession(req, res, u) {
    const t = await auth.createSession(store, u.id);
    return sendJson(res, 200, { user: { id: u.id, name: u.name } }, { 'Set-Cookie': auth.sessionCookie(t, isSecure(req)) });
  }

  async function handleApi(req, res, url, user, token) {
    const p = url.pathname;
    const method = req.method;

    if (method === 'POST') {
      // JSON-only POSTs: a cross-site form cannot send this content type
      // without a CORS preflight, which we never grant.
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) return sendJson(res, 415, { error: 'Send JSON.' });
    }
    const body = method === 'POST' ? await readJson(req) : {};
    if (body === null) return sendJson(res, 400, { error: 'Bad request body.' });

    // ---- accounts
    if (p === '/api/me' && method === 'GET') {
      return sendJson(res, 200, { user: user ? { id: user.id, name: user.name } : null });
    }
    if (p === '/api/signup' && method === 'POST') {
      const n = auth.validateName(body.name);
      if (n.error) return sendJson(res, 400, { error: n.error });
      const pw = auth.validatePassword(body.password);
      if (pw.error) return sendJson(res, 400, { error: pw.error });
      const u = { id: newId(), name: n.name, nameLower: n.name.toLowerCase(), pass: auth.hashPassword(pw.password), createdAt: clock() };
      if (!(await store.insertUser(u))) return sendJson(res, 409, { error: 'That name is taken.' });
      return startSession(req, res, u);
    }
    if (p === '/api/login' && method === 'POST') {
      const u = await store.findUserByName(cleanName(body.name).toLowerCase());
      if (!u || !auth.verifyPassword(String(body.password || ''), u.pass)) return sendJson(res, 401, { error: 'Name or password is wrong.' });
      return startSession(req, res, u);
    }
    if (p === '/api/logout' && method === 'POST') {
      await auth.endSession(store, token);
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie() });
    }

    if (!user) return sendJson(res, 401, { error: 'Please sign in.' });

    // ---- clubs
    if (p === '/api/clubs' && method === 'GET') {
      const [mine, invited] = await Promise.all([store.clubsForUser(user.id), store.invitationsFor(user.id)]);
      const invitations = invited.filter((c) => isCurrent(c) && !game.find(c, user.id)).map(lobbyCard);
      return sendJson(res, 200, { clubs: mine.filter(isCurrent).map((c) => clubSummary(c, user.id)), invitations });
    }
    if (p === '/api/clubs/open' && method === 'GET') {
      const open = (await store.openClubs(60)).filter((c) => isCurrent(c) && !game.find(c, user.id)).slice(0, 50).map(lobbyCard);
      return sendJson(res, 200, { clubs: open });
    }
    if (p === '/api/clubs' && method === 'POST') {
      const name = cleanName(body.name).slice(0, 40) || `${user.name}'s Table`;
      const mode = body.mode === 'timed' ? 'timed' : 'live';
      const visibility = body.visibility === 'public' ? 'public' : 'private';
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const club = game.newTable({ id: newId(), code: newCode(), name, host: { userId: user.id, name: user.name }, mode, visibility, now: clock() });
        if (await store.insertClub(club)) return sendJson(res, 200, { club: clubSummary(club, user.id) });
      }
      return sendJson(res, 503, { error: 'Could not create the club. Please try again.' });
    }
    const decline = p.match(/^\/api\/invitations\/([A-Za-z0-9_-]{6,20})\/decline$/);
    if (decline && method === 'POST') {
      await store.withClub(decline[1], (club) => { if (isCurrent(club)) game.withdrawInvite(club, user.id); });
      return sendJson(res, 200, { ok: true });
    }
    if (p === '/api/clubs/join' && method === 'POST') {
      // The invitation code works for private and public clubs alike. Without
      // a code: a public club, or a private one you were invited to.
      const byCode = Boolean(body.code);
      const id = byCode ? await store.clubIdByCode(String(body.code).toUpperCase().replace(/[^A-Z0-9]/g, '')) : String(body.id || '');
      if (!id && byCode) return sendJson(res, 404, { error: 'No table has that invitation code.' });
      const out = await store.withClub(id, (club) => {
        if (!isCurrent(club)) return { status: 404, body: { error: byCode ? 'No table has that invitation code.' : 'That table is invitation only.' } };
        if (!byCode && club.visibility !== 'public' && !game.isInvited(club, user.id)) return { status: 404, body: { error: 'That table is invitation only.' } };
        game.addPlayer(club, { userId: user.id, name: user.name });
        return { status: 200, body: { club: clubSummary(club, user.id) } };
      });
      return sendJson(res, out.status, out.body);
    }

    const m = p.match(/^\/api\/clubs\/([A-Za-z0-9_-]{6,20})(?:\/([a-z]+))?$/);
    if (!m) return sendJson(res, 404, { error: 'Not found.' });
    const action = m[2] || null;
    if (method !== 'GET' && method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' });
    if (action && method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' });
    if (!action && method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed.' });

    // Looked up before the lock, since it is a separate query.
    const invitee = action === 'invite' ? await store.findUserByName(cleanName(body.name).toLowerCase()) : null;

    const out = await store.withClub(m[1], (club) => {
      if (!isCurrent(club) || !game.find(club, user.id)) return { status: 404, body: { error: 'Table not found.' } };
      const c = ctx();
      if (club.status === 'active') game.tick(club, c);
      if (!action) return { status: 200, body: { club: game.view(club, user.id, c.now) } };

      switch (action) {
        case 'start': game.startGame(club, user.id, c); break;
        case 'leave': game.removePlayer(club, user.id); return { status: 200, body: { ok: true } };
        case 'bots': game.addBots(club, user.id, body.count, rng); break;
        case 'invite':
          if (!invitee) return { status: 404, body: { error: 'No player has that name. Ask them to create an account first.' } };
          game.invitePlayer(club, user.id, invitee, c.now);
          break;
        case 'uninvite':
          if (user.id !== club.hostId) return { status: 403, body: { error: 'Only the host can withdraw invitations.' } };
          game.withdrawInvite(club, String(body.userId || ''));
          break;
        case 'play': game.playCard(club, user.id, String(body.cardId || ''), body.targetId ? String(body.targetId) : null, c); break;
        case 'endturn': game.endTurnAction(club, user.id, c); break;
        case 'night':
          game.playNight(club, user.id, String(body.cardId || ''), body.targetId ? String(body.targetId) : null);
          game.settle(club, c);
          break;
        case 'vote':
          game.castVote(club, user.id, body.targetId ? String(body.targetId) : null);
          game.settle(club, c);
          break;
        case 'pact': game.pact(club, user.id, String(body.op || ''), body.targetId ? String(body.targetId) : null, c); break;
        case 'messages': game.postMessage(club, user.id, body.channel, body.text, body.to ? String(body.to) : null, c.now); break;
        default: return { status: 404, body: { error: 'Not found.' } };
      }
      return { status: 200, body: { club: game.view(club, user.id, c.now) } };
    });
    return sendJson(res, out.status, out.body);
  }

  function isSecure(req) {
    return req.headers['x-forwarded-proto'] === 'https' || Boolean(req.socket.encrypted);
  }

  async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/healthz') return sendJson(res, 200, { ok: true, storage: store.kind });
      if (url.pathname.startsWith('/api/')) {
        const token = cookies(req)[auth.SESSION_COOKIE] || null;
        const user = await auth.userForToken(store, token);
        return await handleApi(req, res, url, user, token);
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && serveStatic(req, res, url.pathname)) return undefined;
      res.writeHead(404, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
      return res.end('Not found');
    } catch (err) {
      if (err instanceof game.GameError) return sendJson(res, err.status, { error: err.message });
      log.error(err);
      if (res.headersSent) return res.end();
      return sendJson(res, 500, { error: 'Something went wrong.' });
    }
  }

  const server = http.createServer(handler);
  server.on('close', () => { if (timer) clearInterval(timer); });
  return { server, store, tickAll };
}

if (require.main === module) {
  (async () => {
    const port = Number(process.env.PORT) || 4400;
    const store = await openStore();
    const { server } = createApp({ store });
    server.listen(port, () => console.log(`MurdrClub is open on port ${port}.`));
    const shutdown = () => {
      server.close(() => store.close().finally(() => process.exit(0)));
      server.closeIdleConnections();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  })().catch((err) => {
    console.error(`MurdrClub could not start: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { createApp, openStore };
