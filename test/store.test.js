'use strict';

/** Storage guarantees: no lost writes, one phase change per deadline, safe coexistence. */

const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../server');
const db = require('../lib/db');
const { backends } = require('./backends');

function client(base) {
  let cookie = '';
  return async function call(p, body) {
    const res = await fetch(base + p, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => null) };
  };
}

async function listen(app) {
  await new Promise((r) => app.server.listen(0, r));
  return `http://127.0.0.1:${app.server.address().port}`;
}

test('connection settings', () => {
  assert.strictEqual(db.connectionString({}), null);
  assert.deepStrictEqual(db.connectionString({ DATABASE_URL: 'postgres://u:p@h:5432/d' }), { url: 'postgres://u:p@h:5432/d', source: 'DATABASE_URL' });
  assert.strictEqual(db.connectionString({ DATABASE_PUBLIC_URL: 'postgres://a/b', DATABASE_URL: 'postgres://c/d' }).source, 'DATABASE_URL', 'the private URL wins');
  assert.throws(() => db.connectionString({ DATABASE_URL: '${{Postgress.DATABASE_URL}}' }), /did not resolve/);
  assert.throws(() => db.connectionString({ DATABASE_URL: 'mysql://x' }), /not a postgres/);
  assert.strictEqual(db.sslFor('postgres://u:p@postgres.railway.internal:5432/railway'), false);
  assert.strictEqual(db.sslFor('postgres://u:p@localhost/x'), false);
  assert.deepStrictEqual(db.sslFor('postgres://u:p@roundhouse.proxy.rlwy.net:41234/railway'), { rejectUnauthorized: false });
  assert.strictEqual(db.sslFor('postgres://u:p@db.example.com/x?sslmode=disable'), false);
});

for (const backend of backends()) {
  // Two servers on the same storage, as with two Railway replicas. The file
  // store cannot be shared between processes, so it runs one server twice.
  const twoServers = async (env, clock) => {
    const a = createApp({ store: await env.open(), tickMs: 0, clock });
    const b = backend.name === 'postgres' ? createApp({ store: await env.open(), tickMs: 0, clock }) : createApp({ store: a.store, tickMs: 0, clock });
    return [a, b];
  };

  test(`${backend.name}: simultaneous votes through two servers are all kept`, async () => {
    const env = await backend.setup();
    let now = Date.UTC(2026, 10, 24, 12);
    const [a, b] = await twoServers(env, () => now);
    try {
      const [baseA, baseB] = [await listen(a), await listen(b)];
      const players = [];
      for (let i = 0; i < 12; i += 1) {
        const c = client(i % 2 ? baseB : baseA);
        await c('/api/signup', { name: `Player ${i}`, password: 'password123' });
        players.push(c);
      }
      const { id } = (await players[0]('/api/clubs', { name: 'Crowded House', visibility: 'public', pace: 'fast' })).body.club;
      await Promise.all(players.slice(1).map((c) => c('/api/clubs/join', { id })));
      const started = await players[0](`/api/clubs/${id}/start`, {});
      assert.strictEqual(started.body.club.players.length, 12, 'all 11 joins landed, though they arrived together');
      await players[0](`/api/clubs/${id}/advance`, {});

      const ids = await Promise.all(players.map(async (c) => (await c('/api/me')).body.user.id));
      // Everyone votes for player 1; player 1 votes for player 0.
      const victimOf = (i) => (i === 1 ? ids[0] : ids[1]);
      const results = await Promise.all(players.map((c, i) => c(`/api/clubs/${id}/vote`, { targetId: victimOf(i) })));
      assert.ok(results.every((r) => r.status === 200), JSON.stringify(results.map((r) => r.body && r.body.error)));
      const after = (await players[5](`/api/clubs/${id}`)).body.club;
      assert.strictEqual(after.action.votesCast, 12, 'no vote was lost to a concurrent write');
    } finally {
      await new Promise((r) => a.server.close(r));
      await new Promise((r) => b.server.close(r));
      await env.teardown();
    }
  });

  test(`${backend.name}: two timers move a phase exactly once`, async () => {
    const env = await backend.setup();
    let now = Date.UTC(2026, 10, 24, 12);
    const [a, b] = await twoServers(env, () => now);
    try {
      const base = await listen(a);
      const host = client(base);
      await host('/api/signup', { name: 'Timekeeper', password: 'password123' });
      const { id } = (await host('/api/clubs', { name: 'Clockwork', pace: 'fast', fastMinutes: { day: 1, tribunal: 1, backroom: 1 } })).body.club;
      await host(`/api/clubs/${id}/bots`, { count: 7 });
      await host(`/api/clubs/${id}/start`, {});

      await Promise.all([a.tickAll(), b.tickAll()]);
      assert.strictEqual((await host(`/api/clubs/${id}`)).body.club.phase, 'day', 'nothing is due yet');

      now += 61 * 1000; // Errands are over
      await Promise.all([a.tickAll(), b.tickAll(), a.tickAll(), b.tickAll()]);
      const club = (await host(`/api/clubs/${id}`)).body.club;
      assert.strictEqual(club.phase, 'tribunal');
      assert.strictEqual(club.events.filter((e) => e.type === 'errand').length, 1, 'the Errand closed once, not once per timer');
    } finally {
      await new Promise((r) => a.server.close(r));
      await new Promise((r) => b.server.close(r));
      await env.teardown();
    }
  });
}

const pg = backends().find((b) => b.name === 'postgres');
test('postgres: the game’s tables sit beside other apps’ tables without touching them', { skip: !pg && 'set TEST_DATABASE_URL to run' }, async () => {
  const env = await pg.setup();
  try {
    const store = await env.open();
    // A table the old site might have left behind, with the same plain name.
    const { Pool } = require('pg');
    const other = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${env.schema}` });
    await other.query('CREATE TABLE users (id serial PRIMARY KEY, email text)');
    await other.query("INSERT INTO users (email) VALUES ('someone@example.com')");
    await store.init(); // running the migrations again is harmless
    assert.ok(await store.insertUser({ id: 'u1', name: 'Ada', nameLower: 'ada', pass: 'x', createdAt: 1 }));
    assert.strictEqual(await store.insertUser({ id: 'u2', name: 'ADA', nameLower: 'ada', pass: 'x', createdAt: 1 }), false);
    const { rows } = await other.query('SELECT email FROM users');
    assert.deepStrictEqual(rows, [{ email: 'someone@example.com' }]);
    const tables = (await other.query("SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY 1", [env.schema])).rows.map((r) => r.table_name);
    assert.deepStrictEqual(tables, ['mc_clubs', 'mc_sessions', 'mc_users', 'users']);
    await other.end();
  } finally {
    await env.teardown();
  }
});
