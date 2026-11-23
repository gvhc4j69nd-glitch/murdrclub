'use strict';

/**
 * Finding and connecting to Postgres.
 *
 * Railway passes the database as DATABASE_URL (usually the reference
 * ${{Postgres.DATABASE_URL}}) and can start the app before the database is
 * accepting connections, so the first connection retries with backoff
 * instead of crash-looping the deploy.
 */

const { Pool } = require('pg');

const POSTGRES_URL = /^postgres(ql)?:\/\/\S/i;
const UNRESOLVED_REFERENCE = /\$\{\{.*\}\}/;
// DATABASE_PUBLIC_URL is last: on Railway it goes out over the internet.
const NAMES = ['DATABASE_URL', 'DATABASE_PRIVATE_URL', 'POSTGRES_URL', 'DATABASE_PUBLIC_URL'];

/**
 * The connection string from the environment, or null if none is set.
 * Throws if a variable is set but unusable, so a typo fails the deploy loudly
 * instead of silently falling back to file storage.
 */
function connectionString(env = process.env) {
  for (const name of NAMES) {
    const value = String(env[name] || '').trim();
    if (!value) continue;
    if (UNRESOLVED_REFERENCE.test(value)) {
      throw new Error(`${name} is "${value}", a Railway reference that did not resolve. Check that the service name inside \${{ }} matches your Postgres service exactly.`);
    }
    if (!POSTGRES_URL.test(value)) throw new Error(`${name} is set but is not a postgres:// URL.`);
    return { url: value, source: name };
  }
  return null;
}

/** Local and Railway-internal connections are plain; anything else uses TLS. */
function sslFor(url) {
  const u = new URL(url);
  const mode = u.searchParams.get('sslmode');
  if (mode === 'disable') return false;
  if (mode === 'require' || mode === 'verify-full') return { rejectUnauthorized: mode === 'verify-full' };
  const host = u.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.railway.internal')) return false;
  return { rejectUnauthorized: false };
}

async function connect(url, { schema = null, attempts = 8, backoffMs = 750, log = console } = {}) {
  const pool = new Pool({
    connectionString: url,
    ssl: sslFor(url),
    max: 10,
    ...(schema ? { options: `-c search_path=${schema}` } : {}),
  });
  pool.on('error', (err) => log.error('Postgres pool error:', err.message));
  for (let i = 1; ; i += 1) {
    try {
      const client = await pool.connect();
      client.release();
      return pool;
    } catch (err) {
      if (i >= attempts) {
        await pool.end().catch(() => {});
        throw new Error(`Could not connect to Postgres after ${attempts} attempts: ${err.message}`);
      }
      log.warn(`Postgres not ready (${err.message}); retrying…`);
      await new Promise((r) => setTimeout(r, backoffMs * i));
    }
  }
}

module.exports = { connectionString, sslFor, connect };
