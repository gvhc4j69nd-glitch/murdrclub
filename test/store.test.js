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

  test(`${backend.name}: four heirs acting at once through two servers are all kept`, async () => {
    const env = await backend.setup();
    let now = Date.UTC(2026, 10, 24, 12);
    const [a, b] = await twoServers(env, () => now);
    try {
      const [baseA, baseB] = [await listen(a), await listen(b)];
      const heirs = [];
      for (let i = 0; i < 4; i += 1) {
        const c = client(i % 2 ? baseB : baseA);
        await c('/api/signup', { name: `Heir ${i}`, password: 'password123' });
        heirs.push(c);
      }
      const { id } = (await heirs[0]('/api/clubs', { name: 'Crowded House', visibility: 'public' })).body.club;
      await Promise.all(heirs.slice(1).map((c) => c('/api/clubs/join', { id })));
      const started = await heirs[0](`/api/clubs/${id}/start`, {});
      assert.strictEqual(started.status, 200, 'all three joins landed, though they arrived together');

      // Get through the Day, one turn at a time.
      for (let i = 0; i < 4; i += 1) {
        const v = (await heirs[0](`/api/clubs/${id}`)).body.club;
        const who = await Promise.all(heirs.map(async (c) => (await c('/api/me')).body.user.id));
        await heirs[who.indexOf(v.turn)](`/api/clubs/${id}/endturn`, {});
      }
      // Night: all four play into the Shadows at the same moment.
      const views = await Promise.all(heirs.map(async (c) => (await c(`/api/clubs/${id}`)).body.club));
      assert.ok(views.every((v) => v.phase === 'night'));
      const results = await Promise.all(heirs.map((c, i) => {
        const bluff = views[i].me.hand.find((x) => x.kind !== 'weapon');
        return c(`/api/clubs/${id}/night`, { cardId: bluff.id });
      }));
      assert.ok(results.every((r) => r.status === 200), JSON.stringify(results.map((r) => r.body && r.body.error)));
      const after = (await heirs[2](`/api/clubs/${id}`)).body.club;
      assert.strictEqual(after.phase, 'inquest', 'every card landed, so the Night resolved without waiting');
      // And four simultaneous votes.
      await Promise.all(heirs.map((c) => c(`/api/clubs/${id}/vote`, { targetId: null })));
      assert.strictEqual((await heirs[1](`/api/clubs/${id}`)).body.club.round, 2);
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
      const { id } = (await host('/api/clubs', { name: 'Clockwork', mode: 'live' })).body.club;
      await host(`/api/clubs/${id}/bots`, { count: 3 });
      await host(`/api/clubs/${id}/start`, {});
      const v0 = (await host(`/api/clubs/${id}`)).body.club;
      // Bots move instantly, so the game is waiting on the human (in the Day or at Night).
      await Promise.all([a.tickAll(), b.tickAll()]);
      assert.strictEqual((await host(`/api/clubs/${id}`)).body.club.events.length, v0.events.length, 'nothing is due yet');

      now = v0.phaseEndsAt + 1000; // the human runs out of time
      await Promise.all([a.tickAll(), b.tickAll(), a.tickAll(), b.tickAll()]);
      const v1 = (await host(`/api/clubs/${id}`)).body.club;
      const timeouts = v1.events.filter((e) => e.type === 'timeout').length;
      assert.ok(v1.events.length > v0.events.length, 'the game moved on');
      assert.ok(timeouts <= 1, 'one deadline, handled once, not once per timer');
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
