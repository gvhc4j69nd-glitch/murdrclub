'use strict';

/**
 * MurdrClub web server (murdrclub.com).
 *
 * Plain Node, no dependencies: serves the single-page app from public/ and a
 * small JSON API under /api. A timer moves every running club to its next
 * phase when its deadline passes.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const game = require('./lib/game');
const auth = require('./lib/auth');
const { createStore } = require('./lib/store');
const { isValidTimeZone } = require('./lib/schedule');

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

function createApp({ dataDir = process.env.DATA_DIR || path.join(__dirname, 'data'), clock = () => Date.now(), rng = Math.random, tickMs = 2000 } = {}) {
  const store = createStore(dataDir);
  const ctx = () => ({ now: clock(), rng });

  const newId = () => crypto.randomBytes(8).toString('base64url');
  function newCode() {
    const taken = new Set(Object.values(store.data.clubs).map((c) => c.code));
    for (;;) {
      let code = '';
      for (const b of crypto.randomBytes(6)) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
      if (!taken.has(code)) return code;
    }
  }

  function tickAll() {
    let changed = false;
    for (const club of Object.values(store.data.clubs)) {
      if (club.status === 'active' && game.tick(club, ctx())) changed = true;
    }
    if (changed) store.save();
  }
  const timer = tickMs ? setInterval(tickAll, tickMs) : null;
  if (timer) timer.unref();

  function clubSummary(club, userId) {
    const me = game.findPlayer(club, userId);
    return {
      id: club.id, name: club.name, code: club.code, status: club.status, phase: club.phase, day: club.day,
      players: club.players.length, alive: club.players.filter((p) => p.alive).length,
      isHost: club.hostId === userId, myRole: me && club.status !== 'lobby' ? me.role : null, myAlive: me ? me.alive : null,
      winner: club.winner, pace: club.settings.pace, visibility: club.visibility,
      seasonDays: club.status === 'lobby' ? game.seasonLength(club.players.length) : club.seasonDays,
    };
  }

  const hostName = (club) => (game.findPlayer(club, club.hostId) || {}).name || '';
  const lobbyCard = (club) => ({
    id: club.id, name: club.name, host: hostName(club), players: club.players.length,
    pace: club.settings.pace, timeZone: club.settings.timeZone, seasonDays: game.seasonLength(club.players.length),
  });
  const findUserByName = (raw) => {
    const lower = String(raw || '').trim().replace(/\s+/g, ' ').toLowerCase();
    return Object.values(store.data.users).find((u) => u.nameLower === lower) || null;
  };

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
      const lower = n.name.toLowerCase();
      if (Object.values(store.data.users).some((u) => u.nameLower === lower)) return sendJson(res, 409, { error: 'That name is taken.' });
      const u = { id: newId(), name: n.name, nameLower: lower, pass: auth.hashPassword(pw.password), createdAt: clock() };
      store.data.users[u.id] = u;
      const t = auth.createSession(store, u.id);
      return sendJson(res, 200, { user: { id: u.id, name: u.name } }, { 'Set-Cookie': auth.sessionCookie(t, isSecure(req)) });
    }
    if (p === '/api/login' && method === 'POST') {
      const lower = String(body.name || '').trim().replace(/\s+/g, ' ').toLowerCase();
      const u = Object.values(store.data.users).find((x) => x.nameLower === lower);
      if (!u || !auth.verifyPassword(String(body.password || ''), u.pass)) return sendJson(res, 401, { error: 'Name or password is wrong.' });
      const t = auth.createSession(store, u.id);
      return sendJson(res, 200, { user: { id: u.id, name: u.name } }, { 'Set-Cookie': auth.sessionCookie(t, isSecure(req)) });
    }
    if (p === '/api/logout' && method === 'POST') {
      auth.endSession(store, token);
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie() });
    }

    if (!user) return sendJson(res, 401, { error: 'Please sign in.' });

    // ---- clubs
    if (p === '/api/clubs' && method === 'GET') {
      const mine = Object.values(store.data.clubs).filter((c) => game.findPlayer(c, user.id));
      mine.sort((a, b) => b.createdAt - a.createdAt);
      const invitations = Object.values(store.data.clubs)
        .filter((c) => c.status === 'lobby' && game.isInvited(c, user.id) && !game.findPlayer(c, user.id))
        .map(lobbyCard);
      return sendJson(res, 200, { clubs: mine.map((c) => clubSummary(c, user.id)), invitations });
    }
    if (p === '/api/clubs/open' && method === 'GET') {
      const open = Object.values(store.data.clubs)
        .filter((c) => c.visibility === 'public' && c.status === 'lobby' && c.players.length < game.MAX_PLAYERS && !game.findPlayer(c, user.id))
        .sort((a, b) => b.players.length - a.players.length)
        .slice(0, 50)
        .map(lobbyCard);
      return sendJson(res, 200, { clubs: open });
    }
    if (p === '/api/clubs' && method === 'POST') {
      const name = String(body.name || '').trim().replace(/\s+/g, ' ').slice(0, 40) || `${user.name}'s Club`;
      const pace = body.pace === 'fast' ? 'fast' : 'daily';
      const timeZone = isValidTimeZone(body.timeZone) ? body.timeZone : 'UTC';
      const mins = (v, d) => Math.max(1, Math.min(120, Math.round(Number(v) || d)));
      const f = body.fastMinutes || {};
      const settings = { pace, timeZone, fastMinutes: { day: mins(f.day, 3), tribunal: mins(f.tribunal, 2), backroom: mins(f.backroom, 1) } };
      const visibility = body.visibility === 'public' ? 'public' : 'private';
      const club = game.newClub({ id: newId(), code: newCode(), name, host: { userId: user.id, name: user.name }, settings, visibility, now: clock() });
      store.data.clubs[club.id] = club;
      store.save();
      return sendJson(res, 200, { club: clubSummary(club, user.id) });
    }
    const decline = p.match(/^\/api\/invitations\/([A-Za-z0-9_-]{6,20})\/decline$/);
    if (decline && method === 'POST') {
      const club = store.data.clubs[decline[1]];
      if (club) { game.withdrawInvite(club, user.id); store.save(); }
      return sendJson(res, 200, { ok: true });
    }
    if (p === '/api/clubs/join' && method === 'POST') {
      let club;
      if (body.code) {
        // The invitation code works for private and public clubs alike.
        const code = String(body.code).toUpperCase().replace(/[^A-Z0-9]/g, '');
        club = Object.values(store.data.clubs).find((c) => c.code === code);
        if (!club) return sendJson(res, 404, { error: 'No club has that invitation code.' });
      } else {
        // Without a code: a public club, or a private one you were invited to.
        club = store.data.clubs[String(body.id || '')];
        if (!club || (club.visibility !== 'public' && !game.isInvited(club, user.id))) {
          return sendJson(res, 404, { error: 'That club is invitation only.' });
        }
      }
      game.addPlayer(club, { userId: user.id, name: user.name });
      store.save();
      return sendJson(res, 200, { club: clubSummary(club, user.id) });
    }

    const m = p.match(/^\/api\/clubs\/([A-Za-z0-9_-]{6,20})(?:\/([a-z]+))?$/);
    if (!m) return sendJson(res, 404, { error: 'Not found.' });
    const club = store.data.clubs[m[1]];
    if (!club || !game.findPlayer(club, user.id)) return sendJson(res, 404, { error: 'Club not found.' });
    const action = m[2] || null;
    const c = ctx();
    if (club.status === 'active' && game.tick(club, c)) store.save();

    if (!action && method === 'GET') return sendJson(res, 200, { club: game.view(club, user.id, c.now) });
    if (method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' });

    switch (action) {
      case 'start': game.startGame(club, user.id, c); break;
      case 'leave': game.removePlayer(club, user.id); store.save(); return sendJson(res, 200, { ok: true });
      case 'bots': game.addBots(club, user.id, body.count, rng); break;
      case 'invite': {
        const invitee = findUserByName(body.name);
        if (!invitee) return sendJson(res, 404, { error: 'No player has that name. Ask them to create an account first.' });
        game.invitePlayer(club, user.id, invitee, c.now);
        break;
      }
      case 'uninvite':
        if (user.id !== club.hostId) return sendJson(res, 403, { error: 'Only the host can withdraw invitations.' });
        game.withdrawInvite(club, String(body.userId || ''));
        break;
      case 'advance': game.hostAdvance(club, user.id, c); break;
      case 'errand': game.answerErrand(club, user.id, body.choice); break;
      case 'vote': game.castVote(club, user.id, String(body.targetId || '')); break;
      case 'toast': game.castToast(club, user.id, body.choice); break;
      case 'murder': game.castMurder(club, user.id, String(body.targetId || '')); break;
      case 'messages': game.postMessage(club, user.id, body.channel, body.text, c.now); break;
      default: return sendJson(res, 404, { error: 'Not found.' });
    }
    store.save();
    return sendJson(res, 200, { club: game.view(club, user.id, c.now) });
  }

  function isSecure(req) {
    return req.headers['x-forwarded-proto'] === 'https' || Boolean(req.socket.encrypted);
  }

  async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/healthz') return sendJson(res, 200, { ok: true });
      if (url.pathname.startsWith('/api/')) {
        const token = cookies(req)[auth.SESSION_COOKIE] || null;
        const user = auth.userForToken(store, token);
        return await handleApi(req, res, url, user, token);
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && serveStatic(req, res, url.pathname)) return undefined;
      res.writeHead(404, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
      return res.end('Not found');
    } catch (err) {
      if (err instanceof game.GameError) return sendJson(res, err.status, { error: err.message });
      console.error(err);
      return sendJson(res, 500, { error: 'Something went wrong.' });
    }
  }

  const server = http.createServer(handler);
  server.on('close', () => { if (timer) clearInterval(timer); store.flushNow(); });
  return { server, store, tickAll };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 4400;
  const { server, store } = createApp();
  server.listen(port, () => console.log(`MurdrClub is open at http://localhost:${port}`));
  const shutdown = () => { store.flushNow(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { createApp };
