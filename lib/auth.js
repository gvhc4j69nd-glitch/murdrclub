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

/** Start a session. Only a hash of the token is stored. */
async function createSession(store, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await store.insertSession(tokenKey(token), userId, Date.now());
  return token;
}

async function userForToken(store, token) {
  if (!token || token.length > 100) return null;
  const key = tokenKey(token);
  const s = await store.getSession(key);
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_DAYS * 86400000) {
    await store.deleteSession(key);
    return null;
  }
  return store.getUser(s.userId);
}

async function endSession(store, token) {
  if (token) await store.deleteSession(tokenKey(token));
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
