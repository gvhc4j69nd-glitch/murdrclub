'use strict';

const test = require('node:test');
const assert = require('node:assert');
const game = require('../lib/game');
const { CARDS, DECK_SIZE } = require('../lib/content');

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

/** A table of four human heirs, dealt and on the first Day. */
function deal({ seed = 1, mode = 'live' } = {}) {
  const ctx = { now: Date.UTC(2026, 10, 24, 12), rng: seeded(seed) };
  const t = game.newTable({ id: 't1', code: 'ABCDEF', name: 'Blackwood', host: { userId: 'u0', name: 'Ada' }, mode, now: ctx.now });
  ['Bea', 'Cy', 'Dot'].forEach((name, i) => game.addPlayer(t, { userId: `u${i + 1}`, name }));
  game.startGame(t, 'u0', ctx);
  return { t, ctx };
}

let n = 0;
/** Put a specific card in an heir's hand and return its id. */
function give(p, type) {
  n += 1;
  const c = { id: `test${n}`, t: type };
  p.hand.push(c);
  return c.id;
}
const seat = (t, i) => t.players[i];
const lastEvent = (t, type) => t.events.filter((e) => e.type === type).at(-1);

function toNight(t, ctx) {
  while (t.phase === 'day') game.endTurnAction(t, game.currentTurn(t).userId, ctx);
}

/** Night: `plays` maps seat index → [cardType, targetSeat]; everyone else bluffs. */
function night(t, ctx, plays = {}) {
  toNight(t, ctx);
  t.players.forEach((p, i) => {
    if (!p.alive || p.arrested) return;
    const [type, target] = plays[i] || ['bequest1'];
    game.playNight(t, p.userId, give(p, type), target === undefined ? null : seat(t, target).userId);
  });
  game.settle(t, ctx);
}

function noArrest(t, ctx) {
  for (const p of t.players.filter((x) => x.alive)) game.castVote(t, p.userId, null);
  game.settle(t, ctx);
}

test('the deck has 72 cards in the right mix', () => {
  assert.strictEqual(DECK_SIZE, 72);
  const count = (kind) => Object.values(CARDS).filter((c) => c.kind === kind).reduce((s, c) => s + c.count, 0);
  assert.deepStrictEqual([count('weapon'), count('defense'), count('scheme'), count('inheritance')], [20, 16, 20, 16]);
});

test('exactly four heirs; the deal; no late joiners', () => {
  const ctx = { now: 0, rng: seeded(1) };
  const t = game.newTable({ id: 't', code: 'C', name: 'N', host: { userId: 'u0', name: 'Ada' }, now: 0 });
  game.addPlayer(t, { userId: 'u1', name: 'Bea' });
  assert.throws(() => game.startGame(t, 'u0', ctx), /exactly 4/);
  game.addBots(t, 'u0', 5, ctx.rng);
  assert.strictEqual(t.players.length, 4, 'bots only fill the empty seats');
  assert.throws(() => game.addPlayer(t, { userId: 'u9', name: 'Late' }), /full/);
  assert.throws(() => game.startGame(t, 'u1', ctx), /Only the host/);

  const { t: d } = deal();
  assert.throws(() => game.addPlayer(d, { userId: 'u9', name: 'Late' }), /No late joiners/);
  assert.strictEqual(d.round, 1);
  assert.strictEqual(d.phase, 'day');
  const first = game.currentTurn(d);
  assert.strictEqual(first.hand.length, 7, 'five dealt plus two drawn');
  assert.ok(d.players.every((p) => p.blood === game.BLOOD && p.coins === 3));
});

test('Day: only on your turn, at most two cards, and Night cards wait for the Night', () => {
  const { t, ctx } = deal();
  const me = game.currentTurn(t);
  const other = t.players.find((p) => p !== me);
  assert.throws(() => game.playCard(t, other.userId, give(other, 'bequest2'), null, ctx), /not your turn/);
  assert.throws(() => game.playCard(t, me.userId, give(me, 'dagger'), other.userId, ctx), /played at Night/);
  assert.throws(() => game.playCard(t, me.userId, give(me, 'blackmail'), me.userId, ctx), /another heir/);
  game.playCard(t, me.userId, give(me, 'bequest4'), null, ctx);
  game.playCard(t, me.userId, give(me, 'bodyguard'), null, ctx);
  assert.throws(() => game.playCard(t, me.userId, give(me, 'bequest1'), null, ctx), /played 2 cards/);
  assert.strictEqual(game.fortune(me), 3 + 4);
  assert.strictEqual(me.bodyguards, 1);
});

test('schemes: Blackmail, Forged Will, Pickpocket, Power Cut, Fire, Frame, Antidote', () => {
  const { t, ctx } = deal();
  const me = game.currentTurn(t);
  const victim = t.players.find((p) => p !== me);
  victim.estate.push({ id: 'v4', t: 'bequest4' });
  me.estate.push({ id: 'm1', t: 'bequest1' });

  game.playCard(t, me.userId, give(me, 'blackmail'), victim.userId, ctx);
  assert.strictEqual(me.coins, 6);
  assert.strictEqual(victim.coins, 0);
  assert.deepStrictEqual([me.infamy, me.suspicion], [1, 1]);
  game.playCard(t, me.userId, give(me, 'forgery'), victim.userId, ctx);
  assert.deepStrictEqual(me.estate.map((c) => c.id), ['v4'], 'my cheapest bequest for one of theirs');
  assert.deepStrictEqual(victim.estate.map((c) => c.id), ['m1']);

  // Next heir: Pickpocket and Power Cut.
  game.endTurnAction(t, me.userId, ctx);
  const thief = game.currentTurn(t);
  const before = me.hand.length;
  game.playCard(t, thief.userId, give(thief, 'pickpocket'), me.userId, ctx);
  assert.strictEqual(me.hand.length, before - 1);
  const hands = t.players.map((p) => p.hand.map((c) => c.id).join());
  game.playCard(t, thief.userId, give(thief, 'powercut'), null, ctx);
  t.players.forEach((p, i) => {
    const fromRight = (i + 3) % 4;
    const expected = i === t.players.indexOf(thief) ? null : hands[fromRight];
    if (expected !== null && t.players[fromRight] !== thief) assert.strictEqual(p.hand.map((c) => c.id).join(), expected);
  });

  // Next heir: Fire and Frame. Then Antidote heals.
  game.endTurnAction(t, thief.userId, ctx);
  const arsonist = game.currentTurn(t);
  const sizes = t.players.map((p) => p.hand.length);
  const fireId = give(arsonist, 'fire');
  game.playCard(t, arsonist.userId, fireId, null, ctx);
  t.players.forEach((p, i) => assert.strictEqual(p.hand.length, Math.max(0, sizes[i] - 2)));
  arsonist.suspicion = 1;
  game.playCard(t, arsonist.userId, give(arsonist, 'frame'), me.userId, ctx);
  assert.strictEqual(arsonist.suspicion, 0);
  assert.strictEqual(me.suspicion, 3);
  game.endTurnAction(t, arsonist.userId, ctx);
  const healer = game.currentTurn(t);
  healer.blood = 2;
  game.playCard(t, healer.userId, give(healer, 'antidote'), null, ctx);
  assert.strictEqual(healer.blood, 3);
});

test('Search is seen only by the searcher', () => {
  const { t, ctx } = deal();
  const me = game.currentTurn(t);
  const target = t.players.find((p) => p !== me);
  game.playCard(t, me.userId, give(me, 'search'), target.userId, ctx);
  const secret = t.events.find((e) => e.private);
  assert.match(secret.text, new RegExp(`${target.name} holds`));
  assert.ok(game.view(t, me.userId, ctx.now).events.some((e) => e.id === secret.id));
  assert.ok(!game.view(t, target.userId, ctx.now).events.some((e) => e.id === secret.id));
});

test('Night: attackers stay secret, and the weapon is named', () => {
  const { t, ctx } = deal();
  night(t, ctx, { 0: ['dagger', 2] });
  const ev = lastEvent(t, 'night');
  assert.match(ev.text, new RegExp(`Someone attacked ${seat(t, 2).name} with the Dagger`));
  assert.ok(!ev.text.includes(seat(t, 0).name), 'the attacker is not named');
  assert.strictEqual(seat(t, 2).blood, game.BLOOD - 1);
  assert.strictEqual(t.phase, 'inquest');
});

test('the Revolver is loud: two wounds, the shooter is named and suspected', () => {
  const { t, ctx } = deal();
  night(t, ctx, { 1: ['revolver', 3] });
  assert.strictEqual(seat(t, 3).blood, game.BLOOD - 2);
  assert.match(lastEvent(t, 'night').text, new RegExp(`${seat(t, 1).name} attacked`));
  assert.strictEqual(seat(t, 1).suspicion, 2);
});

test('defenses: Alibi, Locked Door, Secret Passage, Bodyguard', () => {
  let { t, ctx } = deal();
  night(t, ctx, { 0: ['dagger', 1], 1: ['alibi'] });
  assert.strictEqual(seat(t, 1).blood, game.BLOOD, 'Alibi cancels');

  ({ t, ctx } = deal({ seed: 2 }));
  night(t, ctx, { 0: ['dagger', 1], 2: ['revolver', 1], 1: ['lockeddoor'] });
  assert.strictEqual(seat(t, 1).blood, game.BLOOD, 'Locked Door cancels every attack');

  ({ t, ctx } = deal({ seed: 3 }));
  night(t, ctx, { 0: ['dagger', 1], 1: ['passage'] });
  assert.strictEqual(seat(t, 1).blood, game.BLOOD);
  assert.strictEqual(seat(t, 2).blood, game.BLOOD - 1, 'the attack came out at the next heir to the left');

  ({ t, ctx } = deal({ seed: 4 }));
  seat(t, 3).bodyguards = 1;
  night(t, ctx, { 0: ['revolver', 3] });
  assert.strictEqual(seat(t, 3).blood, game.BLOOD - 1, 'the Bodyguard took one of the two wounds');
  assert.strictEqual(seat(t, 3).bodyguards, 0);
});

test('Poison slips past Bodyguards and strikes again at the next dawn; an Antidote stops it', () => {
  let { t, ctx } = deal();
  seat(t, 2).bodyguards = 1;
  night(t, ctx, { 0: ['poison', 2] });
  assert.strictEqual(seat(t, 2).blood, game.BLOOD - 1);
  assert.strictEqual(seat(t, 2).bodyguards, 1);
  assert.ok(seat(t, 2).poisoned);
  noArrest(t, ctx);
  night(t, ctx);
  assert.strictEqual(seat(t, 2).blood, game.BLOOD - 2, 'the second wound at the next dawn');
  assert.ok(!seat(t, 2).poisoned);

  ({ t, ctx } = deal({ seed: 5 }));
  night(t, ctx, { 0: ['poison', 2] });
  noArrest(t, ctx);
  while (game.currentTurn(t) !== seat(t, 2)) game.endTurnAction(t, game.currentTurn(t).userId, ctx);
  game.playCard(t, seat(t, 2).userId, give(seat(t, 2), 'antidote'), null, ctx);
  night(t, ctx);
  assert.strictEqual(seat(t, 2).blood, game.BLOOD - 1, 'cured in time');
});

test('the Rope ignores Bodyguards against an heir on their last Blood', () => {
  const { t, ctx } = deal();
  seat(t, 1).blood = 1;
  seat(t, 1).bodyguards = 2;
  night(t, ctx, { 0: ['rope', 1] });
  assert.strictEqual(seat(t, 1).alive, false);
});

test('Pacts: a partner’s Alibi covers you; a stab in the back is double and public', () => {
  let { t, ctx } = deal();
  const [a, b] = [seat(t, 0), seat(t, 1)];
  game.pact(t, a.userId, 'propose', b.userId, ctx);
  game.pact(t, b.userId, 'accept', a.userId, ctx);
  assert.strictEqual(a.pactWith, b.userId);
  night(t, ctx, { 2: ['dagger', 1], 0: ['alibi'] });
  assert.strictEqual(b.blood, game.BLOOD, 'A’s Alibi protected B');

  ({ t, ctx } = deal({ seed: 6 }));
  const [x, y] = [seat(t, 0), seat(t, 1)];
  game.pact(t, x.userId, 'propose', y.userId, ctx);
  game.pact(t, y.userId, 'accept', x.userId, ctx);
  night(t, ctx, { 0: ['dagger', 1] });
  assert.strictEqual(y.blood, game.BLOOD - 2, 'double wounds');
  assert.strictEqual(x.infamy, 3);
  assert.strictEqual(x.pactWith, null);
  assert.match(lastEvent(t, 'night').text, new RegExp(`stab in the back: ${x.name} betrayed`));
});

test('the murdered are removed: no turns, no Shadows, no votes, no table talk', () => {
  const { t, ctx } = deal();
  const victim = seat(t, 3);
  victim.blood = 1;
  victim.estate.push({ id: 'e1', t: 'bequest4' });
  night(t, ctx, { 0: ['dagger', 3] });
  assert.strictEqual(victim.alive, false);
  assert.deepStrictEqual([victim.hand.length, victim.estate.length], [0, 0], 'their cards are gone');
  assert.strictEqual(lastEvent(t, 'murder').victim, victim.name);
  assert.strictEqual(seat(t, 0).secretInfamy, 2, 'murder earns secret Infamy');
  assert.throws(() => game.castVote(t, victim.userId, seat(t, 0).userId), /dead/);
  assert.throws(() => game.postMessage(t, victim.userId, 'table', 'boo', null, ctx.now), /dead/);
  noArrest(t, ctx);
  assert.ok(!t.turnOrder.includes(victim.userId));
  toNight(t, ctx);
  assert.throws(() => game.playNight(t, victim.userId, give(victim, 'dagger'), seat(t, 0).userId), /dead/);
  // Others can't see who did it.
  const v = game.view(t, seat(t, 1).userId, ctx.now);
  assert.strictEqual(v.players.find((p) => p.userId === seat(t, 0).userId).infamy, 0);
});

test('the last heir standing wins at once; if none survive, the cat inherits', () => {
  let { t, ctx } = deal();
  [1, 2, 3].forEach((i) => { seat(t, i).blood = 1; });
  night(t, ctx, { 0: ['dagger', 1], 1: ['dagger', 2], 2: ['dagger', 3] });
  assert.strictEqual(t.status, 'ended');
  assert.strictEqual(t.winner, seat(t, 0).userId);
  assert.strictEqual(t.winHow, 'last');

  ({ t, ctx } = deal({ seed: 7 }));
  t.players.forEach((p) => { p.blood = 1; });
  night(t, ctx, { 0: ['dagger', 1], 1: ['dagger', 2], 2: ['dagger', 3], 3: ['dagger', 0] });
  assert.strictEqual(t.status, 'ended');
  assert.strictEqual(t.winner, null);
  assert.match(lastEvent(t, 'end').text, /cat/);
});

test('the Inquest: a majority arrests, fines, empties the hand, and locks the accused up for a night', () => {
  const { t, ctx } = deal();
  night(t, ctx);
  const accused = seat(t, 2);
  accused.suspicion = 4;
  t.players.filter((p) => p !== accused).forEach((p) => game.castVote(t, p.userId, accused.userId));
  game.castVote(t, accused.userId, seat(t, 0).userId);
  game.settle(t, ctx);
  assert.ok(accused.arrested);
  assert.strictEqual(accused.coins, 0, 'fined 3');
  assert.strictEqual(accused.suspicion, 0);
  assert.strictEqual(t.round, 2);
  toNight(t, ctx);
  assert.throws(() => game.playNight(t, accused.userId, give(accused, 'dagger'), seat(t, 0).userId), /cell/);
  night(t, ctx);
  assert.ok(!accused.arrested, 'released after one night');
});

test('two votes of four is not a majority', () => {
  const { t, ctx } = deal();
  night(t, ctx);
  game.castVote(t, seat(t, 0).userId, seat(t, 1).userId);
  game.castVote(t, seat(t, 2).userId, seat(t, 1).userId);
  game.castVote(t, seat(t, 1).userId, seat(t, 0).userId);
  game.castVote(t, seat(t, 3).userId, null);
  game.settle(t, ctx);
  assert.ok(!seat(t, 1).arrested);
  assert.match(lastEvent(t, 'inquest').text, /No majority/);
});

test('the Reading after round 8: most Fortune wins, the most infamous gets a bonus', () => {
  const { t, ctx } = deal();
  for (let r = 1; r <= 8; r += 1) { night(t, ctx); noArrest(t, ctx); }
  assert.strictEqual(t.status, 'ended');
  assert.strictEqual(t.winHow, 'reading');
  assert.strictEqual(t.standings.length, 4);
  const top = t.standings[0];
  assert.strictEqual(top.userId, t.winner);
  assert.ok(t.standings.every((s) => s.fortune <= top.fortune));
});

test('the Infamy bonus can decide the Reading', () => {
  const { t, ctx } = deal();
  for (let r = 1; r < 8; r += 1) { night(t, ctx); noArrest(t, ctx); }
  t.players.forEach((p) => { p.estate = []; p.coins = 10; p.infamy = 0; p.secretInfamy = 0; });
  seat(t, 2).secretInfamy = 2; // a quiet murderer
  night(t, ctx);
  noArrest(t, ctx);
  assert.strictEqual(t.winner, seat(t, 2).userId);
  assert.match(lastEvent(t, 'end').text, /rewards ruthlessness/);
});

test('deadlines: live is seconds, timed is a day per move; a missed Night plays a random card', () => {
  const { t, ctx } = deal();
  assert.strictEqual(t.phaseEndsAt - ctx.now, 45 * 1000);
  const first = game.currentTurn(t);
  ctx.now += 46 * 1000;
  game.tick(t, ctx);
  assert.notStrictEqual(game.currentTurn(t), first, 'the turn passed on');
  toNight(t, ctx);
  const sizes = t.players.map((p) => p.hand.length);
  ctx.now = t.phaseEndsAt;
  game.tick(t, ctx);
  assert.strictEqual(t.phase, 'inquest');
  t.players.forEach((p, i) => assert.strictEqual(p.hand.length, sizes[i] - 1, 'one random card went into the Shadows'));

  const { t: slow, ctx: c2 } = deal({ mode: 'timed' });
  assert.strictEqual(slow.phaseEndsAt - c2.now, 24 * 3600 * 1000);
});

test('what each heir can see', () => {
  const { t, ctx } = deal();
  const me = seat(t, 0);
  game.postMessage(t, seat(t, 1).userId, 'whisper', 'shall we?', seat(t, 2).userId, ctx.now);
  toNight(t, ctx);
  game.playNight(t, seat(t, 1).userId, give(seat(t, 1), 'dagger'), me.userId);
  const v = game.view(t, me.userId, ctx.now);
  assert.strictEqual(v.me.hand.length, me.hand.length);
  const other = v.players.find((p) => p.userId === seat(t, 1).userId);
  assert.ok(!('hand' in other) && other.handCount >= 0);
  assert.strictEqual(other.estateValue, null, 'bequest values are hidden');
  assert.strictEqual(other.playedTonight, true, 'you can see that they played, not what');
  const json = JSON.stringify(v);
  assert.ok(!json.includes('dagger') || v.me.hand.some((c) => c.t === 'dagger'), 'no one else’s dagger leaks');
  assert.ok(!json.includes('shall we?'), 'whispers stay between the two');
  assert.deepStrictEqual(v.nightHistory, []);
});

test('whole games always finish, with every card accounted for (500 seeded all-bot games)', () => {
  for (let s = 1; s <= 500; s += 1) {
    const ctx = { now: 0, rng: seeded(s) };
    const t = game.newTable({ id: 'x', code: 'X', name: 'X', host: { userId: 'bot:h', name: 'H', isBot: true }, now: 0 });
    t.players[0].isBot = true;
    game.addBots(t, 'bot:h', 3, ctx.rng);
    game.startGame(t, 'bot:h', ctx);
    assert.strictEqual(t.status, 'ended', `seed ${s}`);
    const cards = t.deck.length + t.discard.length + t.players.reduce((k, p) => k + p.hand.length + p.estate.length, 0);
    assert.strictEqual(cards, DECK_SIZE, `seed ${s}: cards leaked`);
    assert.ok(t.round <= game.ROUNDS);
    if (t.winner) assert.ok(game.find(t, t.winner).alive);
  }
});
