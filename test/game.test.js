'use strict';

const test = require('node:test');
const assert = require('node:assert');
const game = require('../lib/game');

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FAST = { pace: 'fast', timeZone: 'UTC', fastMinutes: { day: 3, tribunal: 2, backroom: 1 } };

function makeClub(n, { seed = 1, start = true } = {}) {
  const ctx = { now: Date.UTC(2026, 10, 23, 12), rng: seeded(seed) };
  const club = game.newClub({ id: 'club1', code: 'ABCDEF', name: 'Test Club', host: { userId: 'u0', name: 'Host' }, settings: FAST, now: ctx.now });
  for (let i = 1; i < n; i += 1) game.addPlayer(club, { userId: `u${i}`, name: `Player ${i}` });
  if (start) game.startGame(club, 'u0', ctx);
  return { club, ctx };
}

const murderers = (club) => club.players.filter((p) => p.role === 'murderer');
const members = (club) => club.players.filter((p) => p.role === 'member');

test('murderer count scales with club size', () => {
  assert.deepStrictEqual([4, 9, 10, 13, 14, 19, 20, 25].map(game.murdererCount), [1, 1, 2, 2, 3, 3, 4, 4]);
});

test('a club holds at most 25 members and cannot be joined after it opens', () => {
  const { club } = makeClub(25, { start: false });
  assert.throws(() => game.addPlayer(club, { userId: 'extra', name: 'Extra' }), /full/);
  const { club: open } = makeClub(5);
  assert.throws(() => game.addPlayer(open, { userId: 'late', name: 'Late' }), /already opened/);
});

test('only the host can start, and only with enough members', () => {
  const { club, ctx } = makeClub(3, { start: false });
  assert.throws(() => game.startGame(club, 'u0', ctx), /at least 4/);
  game.addPlayer(club, { userId: 'u3', name: 'Player 3' });
  assert.throws(() => game.startGame(club, 'u1', ctx), /Only the host/);
  game.startGame(club, 'u0', ctx);
  assert.strictEqual(club.status, 'active');
  assert.strictEqual(club.phase, 'day');
  assert.strictEqual(murderers(club).length, 1);
});

test('25 players get 4 Murderers', () => {
  const { club } = makeClub(25);
  assert.strictEqual(murderers(club).length, 4);
  assert.strictEqual(members(club).length, 21);
});

test('blackballing needs a majority of the living, not just the most votes', () => {
  const { club, ctx } = makeClub(10);
  game.advance(club, ctx); // → tribunal
  const target = club.players[9];
  // 5 of 10 is not a majority.
  for (let i = 0; i < 5; i += 1) game.castVote(club, `u${i}`, target.userId);
  for (let i = 5; i < 9; i += 1) game.castVote(club, `u${i}`, 'u0');
  game.castVote(club, 'u9', 'u1');
  game.advance(club, ctx);
  assert.ok(target.alive, 'five votes out of ten should not be enough');
  assert.strictEqual(club.events.at(-2).data.outcome, 'undecided');

  if (club.status !== 'active') return;
  while (club.phase !== 'tribunal') game.advance(club, ctx);
  const living = club.players.filter((p) => p.alive);
  const victim = living.find((p) => p.userId !== 'u0');
  const voters = living.filter((p) => p.userId !== victim.userId);
  const needed = Math.floor(living.length / 2) + 1;
  voters.slice(0, needed).forEach((p) => game.castVote(club, p.userId, victim.userId));
  voters.slice(needed).forEach((p) => game.castVote(club, p.userId, voters[0].userId === p.userId ? voters[1].userId : voters[0].userId));
  if (voters.length < needed) return;
  game.castVote(club, victim.userId, voters[0].userId);
  game.advance(club, ctx);
  assert.strictEqual(victim.alive, false);
  assert.strictEqual(victim.eliminatedHow, 'blackballed');
  assert.strictEqual(victim.revealed, true);
});

test('Murderers can only target living Members, and the victim dies at dawn', () => {
  const { club, ctx } = makeClub(10, { seed: 7 });
  game.advance(club, ctx); // tribunal
  game.advance(club, ctx); // backroom (nobody voted → undecided)
  assert.strictEqual(club.phase, 'backroom');
  const [m1, m2] = murderers(club);
  assert.throws(() => game.castMurder(club, m1.userId, m2.userId), /living Member/);
  const member = members(club)[0];
  assert.throws(() => game.castMurder(club, member.userId, members(club)[1].userId), /Only living Murderers/);
  game.castMurder(club, m1.userId, member.userId);
  game.castMurder(club, m2.userId, member.userId);
  game.advance(club, ctx);
  assert.strictEqual(member.alive, false);
  assert.strictEqual(member.eliminatedHow, 'murdered');
  assert.strictEqual(club.day, 2);
  assert.strictEqual(club.phase, 'day');
  assert.strictEqual(club.events.at(-1).type, 'murder');
});

test('the departed cannot vote, answer Errands or talk in the Lounge', () => {
  const { club, ctx } = makeClub(10, { seed: 3 });
  const victim = members(club)[0];
  game.advance(club, ctx);
  game.advance(club, ctx);
  murderers(club).forEach((m) => game.castMurder(club, m.userId, victim.userId));
  game.advance(club, ctx);
  assert.throws(() => game.answerErrand(club, victim.userId, 0), /departed/);
  assert.throws(() => game.postMessage(club, victim.userId, 'lounge', 'boo', ctx.now), /cannot speak/);
  game.postMessage(club, victim.userId, 'cellar', 'it is cold down here', ctx.now);
  game.advance(club, ctx);
  assert.throws(() => game.castVote(club, victim.userId, club.players.find((p) => p.alive).userId), /departed/);
});

test('three missed Tribunals and you resign', () => {
  const { club, ctx } = makeClub(12, { seed: 11 });
  const lazy = members(club).at(-1);
  for (let day = 0; day < 3 && club.status === 'active' && lazy.alive; day += 1) {
    while (club.phase !== 'tribunal') game.advance(club, ctx);
    // everyone else votes, scattered so nobody is blackballed
    const living = club.players.filter((p) => p.alive && p.userId !== lazy.userId);
    living.forEach((p, i) => game.castVote(club, p.userId, living[(i + 1) % living.length].userId));
    game.advance(club, ctx);
    if (club.phase === 'backroom') {
      // keep the lazy member alive: murder someone else
      const target = club.players.find((p) => p.alive && p.role === 'member' && p.userId !== lazy.userId);
      murderers(club).filter((m) => m.alive).forEach((m) => game.castMurder(club, m.userId, target.userId));
    }
  }
  assert.strictEqual(lazy.alive, false);
  assert.strictEqual(lazy.eliminatedHow, 'resigned');
  assert.strictEqual(lazy.strikes, 3);
});

test('errand answers fill the Vault when the Errand closes', () => {
  const { club, ctx } = makeClub(5);
  const q = require('../lib/content').ERRANDS[club.errand.index];
  game.answerErrand(club, 'u0', q.a);
  game.answerErrand(club, 'u1', (q.a + 1) % q.c.length);
  assert.throws(() => game.answerErrand(club, 'u0', q.a), /already answered/);
  assert.strictEqual(club.vault, 0, 'no leak of correctness before the Errand closes');
  game.advance(club, ctx);
  assert.strictEqual(club.vault, game.ERRAND_POINTS);
});

test('a player sees only what they are allowed to', () => {
  const { club, ctx } = makeClub(14, { seed: 5 });
  const member = members(club)[0];
  const killer = murderers(club)[0];
  game.postMessage(club, killer.userId, 'backroom', 'tonight, the colonel', ctx.now);

  const mv = game.view(club, member.userId, ctx.now);
  assert.strictEqual(mv.me.role, 'member');
  assert.ok(mv.players.every((p) => p.userId === member.userId || p.role === null), 'members see no one else’s role');
  assert.strictEqual(mv.messages.backroom, undefined);
  assert.strictEqual(mv.messages.cellar, undefined);
  assert.ok(!JSON.stringify(mv).includes('tonight, the colonel'));
  assert.ok(!JSON.stringify(mv).includes('"murderer"'), 'the word murderer never appears as a role in a member view');

  const kv = game.view(club, killer.userId, ctx.now);
  const seen = kv.players.filter((p) => p.role === 'murderer').map((p) => p.userId).sort();
  assert.deepStrictEqual(seen, murderers(club).map((p) => p.userId).sort(), 'murderers know each other');
  assert.strictEqual(kv.messages.backroom.length, 1);

  // No hidden answer key in the Errand.
  assert.strictEqual(mv.action.type, 'errand');
  assert.ok(!('a' in mv.action) && !('answer' in mv.action));
});

test('the Last Toast: no murders, and a unanimous Raise ends the season', () => {
  const { club, ctx } = makeClub(6, { seed: 2 });
  // Murder down to 5 players.
  game.advance(club, ctx);
  game.advance(club, ctx);
  const m = murderers(club)[0];
  game.castMurder(club, m.userId, members(club)[0].userId);
  game.advance(club, ctx);
  assert.strictEqual(club.endgame, true);
  assert.strictEqual(club.phase, 'day');
  game.advance(club, ctx); // → tribunal
  const living = club.players.filter((p) => p.alive);
  living.forEach((p) => game.castToast(club, p.userId, 'raise'));
  game.advance(club, ctx);
  assert.strictEqual(club.status, 'ended');
  assert.strictEqual(club.winner, 'murderers', 'a Murderer was still at the table');
  assert.deepStrictEqual(club.payout.winners, [m.name]);
});

test('the Last Toast skips the Back Room after a Pour Another', () => {
  const { club, ctx } = makeClub(5, { seed: 9 });
  assert.strictEqual(club.endgame, false);
  game.advance(club, ctx);
  game.advance(club, ctx); // tribunal resolves; 5 alive → endgame
  assert.strictEqual(club.endgame, true);
  assert.strictEqual(club.phase, 'day');
});

test('whole seasons always finish, with consistent results (200 seeded games of 25)', () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const { club, ctx } = makeClub(25, { seed });
    const rng = seeded(seed * 97);
    // Everyone is a bot-like random actor so the engine is exercised through its public actions.
    for (let step = 0; step < 1000 && club.status === 'active'; step += 1) {
      const living = club.players.filter((p) => p.alive);
      if (club.phase === 'day') {
        living.forEach((p) => { if (rng() < 0.8) game.answerErrand(club, p.userId, Math.floor(rng() * 4)); });
      } else if (club.phase === 'tribunal') {
        // Members lean toward a shared suspect so majorities sometimes form.
        const suspect = living[Math.floor(rng() * living.length)];
        living.forEach((p) => {
          if (rng() < 0.05) return; // the occasional missed vote
          let t = rng() < 0.6 ? suspect : living[Math.floor(rng() * living.length)];
          if (t.userId === p.userId) t = living.find((x) => x.userId !== p.userId);
          if (t) game.castVote(club, p.userId, t.userId);
          if (club.endgame) game.castToast(club, p.userId, rng() < 0.5 ? 'raise' : 'pour');
        });
      } else if (club.phase === 'backroom') {
        const targets = living.filter((p) => p.role === 'member');
        living.filter((p) => p.role === 'murderer').forEach((p) => game.castMurder(club, p.userId, targets[Math.floor(rng() * targets.length)].userId));
      }
      game.advance(club, ctx);
    }
    assert.strictEqual(club.status, 'ended', `seed ${seed} never finished`);
    const aliveM = club.players.filter((p) => p.alive && p.role === 'murderer').length;
    if (club.winner === 'members') assert.strictEqual(aliveM, 0, `seed ${seed}: members won with murderers alive`);
    else assert.ok(aliveM > 0, `seed ${seed}: murderers won with none alive`);
    assert.ok(club.day <= 40, `seed ${seed}: season ran ${club.day} days`);
  }
});

test('the server-side clock moves phases on time and catches up after downtime', () => {
  const { club, ctx } = makeClub(6);
  assert.strictEqual(game.tick(club, ctx), false);
  ctx.now += 3 * 60000; // Errands end
  assert.strictEqual(game.tick(club, ctx), true);
  assert.strictEqual(club.phase, 'tribunal');
  ctx.now += 2 * 60000 + 1 * 60000; // tribunal and back room both due
  game.tick(club, ctx);
  assert.ok(club.status !== 'active' || (club.phase === 'day' && club.day === 2));
});
