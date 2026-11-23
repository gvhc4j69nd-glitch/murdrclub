'use strict';

/** Plays a club end to end over HTTP: accounts, invitations, bots, phases. */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../server');

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

test('a club can be founded, filled, and played to the end over HTTP', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'murdrclub-'));
  const { server } = createApp({ dataDir, tickMs: 0 });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const host = client(base);
    const guest = client(base);
    const stranger = client(base);

    assert.strictEqual((await host('/api/clubs')).status, 401);
    assert.strictEqual((await host('/api/signup', { name: 'Ada', password: 'short' })).status, 400);
    assert.strictEqual((await host('/api/signup', { name: 'Ada', password: 'correct horse' })).status, 200);
    assert.strictEqual((await guest('/api/signup', { name: 'ada', password: 'whatever123' })).status, 409, 'names are unique, ignoring case');
    assert.strictEqual((await guest('/api/signup', { name: 'Grace', password: 'whatever123' })).status, 200);
    assert.strictEqual((await stranger('/api/signup', { name: 'Eve', password: 'whatever123' })).status, 200);

    // Plain form posts are refused (CSRF guard).
    const form = await fetch(`${base}/api/logout`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'x=1' });
    assert.strictEqual(form.status, 415);

    const created = await host('/api/clubs', { name: 'Blackwood Manor', pace: 'fast', timeZone: 'Europe/Paris', fastMinutes: { day: 1, tribunal: 1, backroom: 1 } });
    assert.strictEqual(created.status, 200);
    const { id, code } = created.body.club;

    assert.strictEqual((await guest('/api/clubs/join', { code: code.toLowerCase() })).status, 200);
    assert.strictEqual((await stranger(`/api/clubs/${id}`)).status, 404, 'non-members cannot see the club');
    assert.strictEqual((await guest(`/api/clubs/${id}/bots`, { count: 3 })).status, 403);
    assert.strictEqual((await host(`/api/clubs/${id}/bots`, { count: 8 })).status, 200);
    assert.strictEqual((await guest(`/api/clubs/${id}/start`, {})).status, 403);

    const started = await host(`/api/clubs/${id}/start`, {});
    assert.strictEqual(started.status, 200);
    assert.strictEqual(started.body.club.players.length, 10);
    assert.strictEqual(started.body.club.phase, 'day');
    assert.ok(['member', 'murderer'].includes(started.body.club.me.role));

    // Lounge chat
    assert.strictEqual((await guest(`/api/clubs/${id}/messages`, { channel: 'lounge', text: 'Good evening, all.' })).status, 200);

    // Play: humans vote for the first other living player; host advances phases.
    for (let step = 0; step < 300; step += 1) {
      const { body } = await host(`/api/clubs/${id}`);
      const club = body.club;
      if (club.status === 'ended') break;
      for (const who of [host, guest]) {
        const v = (await who(`/api/clubs/${id}`)).body.club;
        if (!v.me.alive) continue;
        const others = v.players.filter((p) => p.alive && p.userId !== v.me.userId);
        if (v.phase === 'day' && v.action.myAnswer === null) await who(`/api/clubs/${id}/errand`, { choice: 0 });
        if (v.phase === 'tribunal') {
          await who(`/api/clubs/${id}/vote`, { targetId: others[0].userId });
          if (v.endgame) await who(`/api/clubs/${id}/toast`, { choice: 'raise' });
        }
        if (v.phase === 'backroom' && v.me.role === 'murderer') {
          const target = v.players.find((p) => p.alive && p.role !== 'murderer');
          await who(`/api/clubs/${id}/murder`, { targetId: target.userId });
        }
      }
      const adv = await host(`/api/clubs/${id}/advance`, {});
      assert.strictEqual(adv.status, 200, JSON.stringify(adv.body));
    }

    const final = (await guest(`/api/clubs/${id}`)).body.club;
    assert.strictEqual(final.status, 'ended');
    assert.ok(['members', 'murderers'].includes(final.winner));
    assert.ok(final.players.every((p) => p.role), 'every card is face up at the end');
    assert.ok(final.messages.backroom && final.messages.cellar, 'every room opens for the recap');

    const list = (await guest('/api/clubs')).body.clubs;
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].status, 'ended');
  } finally {
    await new Promise((r) => server.close(r));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('private clubs are invitation only; public clubs are listed; no late joiners', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'murdrclub-'));
  const { server } = createApp({ dataDir, tickMs: 0 });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const host = client(base);
    const friend = client(base);
    const stranger = client(base);
    await host('/api/signup', { name: 'Marple', password: 'st mary mead' });
    await friend('/api/signup', { name: 'Hastings', password: 'mon ami 123' });
    const strangerId = (await stranger('/api/signup', { name: 'Ratchett', password: 'orient express' })).body.user.id;

    const priv = (await host('/api/clubs', { name: 'Secret Supper' })).body.club;
    assert.strictEqual(priv.visibility, 'private', 'clubs are private by default');
    assert.strictEqual((await stranger('/api/clubs/open')).body.clubs.length, 0, 'private clubs are not listed');
    assert.strictEqual((await stranger('/api/clubs/join', { id: priv.id })).status, 404, 'no joining a private club without an invitation');

    // Invite by name.
    assert.strictEqual((await host(`/api/clubs/${priv.id}/invite`, { name: 'nobody here' })).status, 404);
    assert.strictEqual((await friend(`/api/clubs/${priv.id}`)).status, 404);
    assert.strictEqual((await host(`/api/clubs/${priv.id}/invite`, { name: 'hastings' })).status, 200);
    const invites = (await friend('/api/clubs')).body.invitations;
    assert.deepStrictEqual(invites.map((c) => c.name), ['Secret Supper']);
    assert.strictEqual((await friend('/api/clubs/join', { id: priv.id })).status, 200);
    assert.strictEqual((await friend('/api/clubs')).body.invitations.length, 0);

    // Only the host sees the private code.
    assert.ok((await host(`/api/clubs/${priv.id}`)).body.club.code);
    assert.strictEqual((await friend(`/api/clubs/${priv.id}`)).body.club.code, null);
    assert.strictEqual((await friend(`/api/clubs/${priv.id}/invite`, { name: 'Ratchett' })).status, 403);

    // Declining an invitation.
    await host(`/api/clubs/${priv.id}/invite`, { name: 'Ratchett' });
    assert.strictEqual((await stranger(`/api/invitations/${priv.id}/decline`, {})).status, 200);
    assert.strictEqual((await stranger('/api/clubs/join', { id: priv.id })).status, 404);
    assert.strictEqual((await host(`/api/clubs/${priv.id}`)).body.club.invites.length, 0);

    // A public club is listed and joinable without a code.
    const pub = (await host('/api/clubs', { name: 'Open House', visibility: 'public' })).body.club;
    const open = (await stranger('/api/clubs/open')).body.clubs;
    assert.deepStrictEqual(open.map((c) => c.name), ['Open House']);
    assert.strictEqual(open[0].host, 'Marple');
    assert.strictEqual((await stranger('/api/clubs/join', { id: pub.id })).status, 200);
    assert.ok((await stranger(`/api/clubs/${pub.id}`)).body.club.code, 'members of a public club can see its code');

    // No late joiners: 8 needed to start, nobody after.
    assert.strictEqual((await host(`/api/clubs/${priv.id}/start`, {})).status, 409);
    await host(`/api/clubs/${priv.id}/bots`, { count: 6 });
    const started = await host(`/api/clubs/${priv.id}/start`, {});
    assert.strictEqual(started.status, 200);
    assert.strictEqual(started.body.club.seasonDays, 4);
    assert.strictEqual((await host(`/api/clubs/${priv.id}/invite`, { name: 'Ratchett' })).status, 409);
    const code = (await host(`/api/clubs/${priv.id}`)).body.club.code;
    const late = await stranger('/api/clubs/join', { code });
    assert.strictEqual(late.status, 409);
    assert.match(late.body.error, /No late joiners/);
    assert.ok(strangerId);
  } finally {
    await new Promise((r) => server.close(r));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('the club survives a restart', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'murdrclub-'));
  try {
    let app = createApp({ dataDir, tickMs: 0 });
    await new Promise((r) => app.server.listen(0, r));
    let base = `http://127.0.0.1:${app.server.address().port}`;
    const c = client(base);
    await c('/api/signup', { name: 'Poirot', password: 'little grey cells' });
    const { id } = (await c('/api/clubs', { name: 'Styles' })).body.club;
    await new Promise((r) => app.server.close(r));

    app = createApp({ dataDir, tickMs: 0 });
    await new Promise((r) => app.server.listen(0, r));
    base = `http://127.0.0.1:${app.server.address().port}`;
    const again = client(base);
    assert.strictEqual((await again('/api/login', { name: 'poirot', password: 'little grey cells' })).status, 200);
    const got = await again(`/api/clubs/${id}`);
    assert.strictEqual(got.status, 200);
    assert.strictEqual(got.body.club.name, 'Styles');
    await new Promise((r) => app.server.close(r));
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
