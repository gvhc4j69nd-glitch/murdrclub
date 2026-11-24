'use strict';

/** Plays tables end to end over HTTP, against every storage backend. */

const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../server');
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

async function open(backend) {
  const env = await backend.setup();
  const app = createApp({ store: await env.open(), tickMs: 0 });
  await new Promise((r) => app.server.listen(0, r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return { env, app, base, close: async () => { await new Promise((r) => app.server.close(r)); await env.teardown(); } };
}

/** Make one move for this heir if the game is waiting on them. */
async function move(who, id) {
  const v = (await who(`/api/clubs/${id}`)).body.club;
  if (v.status !== 'active' || !v.me.alive) return v;
  const others = v.players.filter((p) => p.alive && p.userId !== v.me.userId);
  if (v.phase === 'day' && v.turn === v.me.userId) {
    const bequest = v.me.hand.find((c) => c.kind === 'inheritance');
    if (bequest) assert.strictEqual((await who(`/api/clubs/${id}/play`, { cardId: bequest.id })).status, 200);
    assert.strictEqual((await who(`/api/clubs/${id}/endturn`, {})).status, 200);
  } else if (v.phase === 'night' && v.me.mustPlayNight && !v.me.nightPlayed) {
    const c = v.me.hand[0];
    const r = await who(`/api/clubs/${id}/night`, { cardId: c.id, targetId: c.kind === 'weapon' ? others[0].userId : null });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  } else if (v.phase === 'inquest' && v.me.vote === undefined) {
    assert.strictEqual((await who(`/api/clubs/${id}/vote`, { targetId: null })).status, 200);
  }
  return v;
}

for (const backend of backends()) {
  test(`${backend.name}: a table is dealt and played to the Reading over HTTP`, async () => {
    const { base, close } = await open(backend);
    try {
      const host = client(base);
      const guest = client(base);
      const stranger = client(base);
      assert.strictEqual((await host('/api/clubs')).status, 401);
      assert.strictEqual((await host('/api/signup', { name: 'Ada', password: 'short' })).status, 400);
      assert.strictEqual((await host('/api/signup', { name: 'Ada', password: 'correct horse' })).status, 200);
      assert.strictEqual((await guest('/api/signup', { name: 'ada', password: 'whatever123' })).status, 409, 'names are unique, ignoring case');
      assert.strictEqual((await guest('/api/signup', { name: 'Grace', password: 'whatever123' })).status, 200);
      await stranger('/api/signup', { name: 'Eve', password: 'whatever123' });

      const form = await fetch(`${base}/api/logout`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'x=1' });
      assert.strictEqual(form.status, 415, 'plain form posts are refused');

      const created = await host('/api/clubs', { name: 'Blackwood Manor', mode: 'live' });
      const { id, code } = created.body.club;
      assert.strictEqual(created.body.club.mode, 'live');
      assert.strictEqual((await guest('/api/clubs/join', { code: code.toLowerCase() })).status, 200);
      assert.strictEqual((await stranger(`/api/clubs/${id}`)).status, 404, 'non-players cannot see the table');
      assert.strictEqual((await host(`/api/clubs/${id}/start`, {})).status, 409, 'needs four');
      assert.strictEqual((await guest(`/api/clubs/${id}/bots`, { count: 2 })).status, 403);
      await host(`/api/clubs/${id}/bots`, { count: 5 });
      const started = await host(`/api/clubs/${id}/start`, {});
      assert.strictEqual(started.status, 200);
      assert.strictEqual(started.body.club.players.length, 4);
      assert.strictEqual((await stranger('/api/clubs/join', { code })).status, 409, 'no late joiners');

      const hostId = started.body.club.me.userId;
      assert.strictEqual((await guest(`/api/clubs/${id}/messages`, { channel: 'table', text: 'Lovely evening.' })).status, 200);
      assert.strictEqual((await guest(`/api/clubs/${id}/messages`, { channel: 'whisper', to: hostId, text: 'A pact?' })).status, 200);
      const hv = (await host(`/api/clubs/${id}`)).body.club;
      assert.deepStrictEqual(hv.messages.whispers.map((w) => w.text), ['A pact?']);

      let v;
      for (let step = 0; step < 400; step += 1) {
        v = await move(host, id);
        await move(guest, id);
        if (v.status === 'ended') break;
      }
      v = (await guest(`/api/clubs/${id}`)).body.club;
      assert.strictEqual(v.status, 'ended');
      assert.strictEqual(v.standings.length, 4);
      assert.ok(v.nightHistory.length >= 1, 'the Shadows are revealed at the end');
      assert.ok(v.players.every((p) => p.estateValue !== null), 'every Estate is turned over');

      const list = (await guest('/api/clubs')).body.clubs;
      assert.strictEqual(list[0].status, 'ended');
    } finally {
      await close();
    }
  });

  test(`${backend.name}: private tables are invitation only; public ones are listed`, async () => {
    const { base, close } = await open(backend);
    try {
      const host = client(base);
      const friend = client(base);
      const stranger = client(base);
      await host('/api/signup', { name: 'Marple', password: 'st mary mead' });
      await friend('/api/signup', { name: 'Hastings', password: 'mon ami 123' });
      await stranger('/api/signup', { name: 'Ratchett', password: 'orient express' });

      const priv = (await host('/api/clubs', { name: 'Secret Supper', mode: 'timed' })).body.club;
      assert.deepStrictEqual([priv.visibility, priv.mode], ['private', 'timed']);
      assert.strictEqual((await stranger('/api/clubs/open')).body.clubs.length, 0);
      assert.strictEqual((await stranger('/api/clubs/join', { id: priv.id })).status, 404);
      assert.strictEqual((await host(`/api/clubs/${priv.id}/invite`, { name: 'nobody here' })).status, 404);
      assert.strictEqual((await host(`/api/clubs/${priv.id}/invite`, { name: 'hastings' })).status, 200);
      assert.deepStrictEqual((await friend('/api/clubs')).body.invitations.map((c) => c.name), ['Secret Supper']);
      assert.strictEqual((await friend('/api/clubs/join', { id: priv.id })).status, 200);
      assert.strictEqual((await friend(`/api/clubs/${priv.id}`)).body.club.code, null, 'only the host sees a private code');
      await host(`/api/clubs/${priv.id}/invite`, { name: 'Ratchett' });
      assert.strictEqual((await stranger(`/api/invitations/${priv.id}/decline`, {})).status, 200);
      assert.strictEqual((await stranger('/api/clubs/join', { id: priv.id })).status, 404);

      const pub = (await host('/api/clubs', { name: 'Open House', visibility: 'public' })).body.club;
      const open = (await stranger('/api/clubs/open')).body.clubs;
      assert.deepStrictEqual(open.map((c) => [c.name, c.seats]), [['Open House', 4]]);
      assert.strictEqual((await stranger('/api/clubs/join', { id: pub.id })).status, 200);

      await host(`/api/clubs/${priv.id}/bots`, { count: 2 });
      const started = (await host(`/api/clubs/${priv.id}/start`, {})).body.club;
      assert.strictEqual(started.phaseEndsAt - started.now, 24 * 3600 * 1000, 'timed: a day per move');
      assert.strictEqual((await host(`/api/clubs/${priv.id}/invite`, { name: 'Ratchett' })).status, 409);
    } finally {
      await close();
    }
  });

  test(`${backend.name}: a table survives a restart`, async () => {
    const env = await backend.setup();
    try {
      const first = await env.open();
      let app = createApp({ store: first, tickMs: 0 });
      await new Promise((r) => app.server.listen(0, r));
      const c = client(`http://127.0.0.1:${app.server.address().port}`);
      await c('/api/signup', { name: 'Poirot', password: 'little grey cells' });
      const { id } = (await c('/api/clubs', { name: 'Styles' })).body.club;
      await c(`/api/clubs/${id}/bots`, { count: 3 });
      await c(`/api/clubs/${id}/start`, {});
      await new Promise((r) => app.server.close(r));
      await first.close();

      app = createApp({ store: await env.open(), tickMs: 0 });
      await new Promise((r) => app.server.listen(0, r));
      const again = client(`http://127.0.0.1:${app.server.address().port}`);
      assert.strictEqual((await again('/api/login', { name: 'poirot', password: 'little grey cells' })).status, 200);
      const got = (await again(`/api/clubs/${id}`)).body.club;
      assert.strictEqual(got.name, 'Styles');
      assert.strictEqual(got.status, 'active');
      assert.ok(got.me.hand.length >= 5);
      await new Promise((r) => app.server.close(r));
    } finally {
      await env.teardown();
    }
  });
}
