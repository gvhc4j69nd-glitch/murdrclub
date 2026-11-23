'use strict';

/**
 * The storage backends the tests run against.
 *
 * The file store always runs. Postgres runs when TEST_DATABASE_URL is set,
 * for example:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/murdrclub_test npm test
 * Each test gets its own throwaway schema, so test files can run in parallel.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const db = require('../lib/db');
const { createFileStore, createPgStore } = require('../lib/store');

const quiet = { log() {}, warn() {}, error() {} };

function fileBackend() {
  return {
    name: 'file',
    async setup() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'murdrclub-'));
      const open = [];
      return {
        async open() {
          const store = createFileStore(dir);
          open.push(store);
          return store;
        },
        async teardown() {
          for (const s of open) await s.close().catch(() => {});
          fs.rmSync(dir, { recursive: true, force: true });
        },
      };
    },
  };
}

function pgBackend(url) {
  return {
    name: 'postgres',
    async setup() {
      const schema = `mc_test_${crypto.randomBytes(6).toString('hex')}`;
      const admin = new Pool({ connectionString: url, ssl: db.sslFor(url) });
      await admin.query(`CREATE SCHEMA ${schema}`);
      const open = [];
      return {
        schema,
        async open() {
          const pool = await db.connect(url, { schema, attempts: 1, log: quiet });
          const store = createPgStore(pool);
          await store.init();
          open.push(store);
          return store;
        },
        async teardown() {
          for (const s of open) await s.close().catch(() => {});
          await admin.query(`DROP SCHEMA ${schema} CASCADE`);
          await admin.end();
        },
      };
    },
  };
}

function backends() {
  const url = (process.env.TEST_DATABASE_URL || '').trim();
  return url ? [fileBackend(), pgBackend(url)] : [fileBackend()];
}

module.exports = { backends };
