'use strict';

/** Accounts and sessions: a display name, a scrypt-hashed password, a cookie. */

const crypto = require('crypto');

const SESSION_COOKIE = 'mc_session';
const SESSION_DAYS = 60;
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} .'_-]{1,23}$/u;

function validateName(raw) {
  const name = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!NAME_RE.test(name)) return { error: 'Names are 2–24 characters: letters, numbers, spaces, and . \' _ -' };
  if (name.toLowerCase().startsWith('bot')) return { error: 'That name is reserved.' };
  return { name };
}

function validatePassword(raw) {
  const pw = String(raw || '');
  if (pw.length < 8) return { error: 'Passwords need at least 8 characters.' };
  if (pw.length > 200) return { error: 'That password is too long.' };
  return { password: pw };
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [kind, saltHex, hashHex] = String(stored).split(':');
  if (kind !== 'scrypt') return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const tokenKey = (token) => crypto.createHash('sha256').update(token).digest('hex');

function createSession(store, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  store.data.sessions[tokenKey(token)] = { userId, createdAt: Date.now() };
  store.save();
  return token;
}

function userForToken(store, token) {
  if (!token) return null;
  const s = store.data.sessions[tokenKey(token)];
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_DAYS * 86400000) {
    delete store.data.sessions[tokenKey(token)];
    return null;
  }
  return store.data.users[s.userId] || null;
}

function endSession(store, token) {
  if (token) delete store.data.sessions[tokenKey(token)];
  store.save();
}

function sessionCookie(token, secure) {
  const parts = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${SESSION_DAYS * 86400}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

const clearCookie = () => `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

module.exports = {
  SESSION_COOKIE, validateName, validatePassword, hashPassword, verifyPassword,
  createSession, userForToken, endSession, sessionCookie, clearCookie,
};
