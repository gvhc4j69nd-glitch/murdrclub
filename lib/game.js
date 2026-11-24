'use strict';

/**
 * MURDRCLUB: The Reading of the Will. A four-heir card game of murder and mayhem.
 *
 * A table is a plain JSON object. Every function here takes the table and a
 * context `{ now, rng }` and changes the table in place, so whole games can be
 * played in tests with a fake clock and a seeded random source. Nothing in
 * this file knows about HTTP or storage.
 *
 * Each of the 8 rounds:
 *   Day      heirs take turns: draw 2, play up to 2 cards in the open.
 *   Night    every heir plays one card face down into the Shadows: a weapon
 *            aimed at someone, a defense, or anything as a bluff. Attacks are
 *            resolved anonymously.
 *   Inquest  everyone votes; a majority arrests the accused.
 * After round 8 the will is read: the richest living heir wins. The last heir
 * alive wins at once. Murdered heirs are out of the game.
 */

const { CARDS, BOT_NAMES, murderNotice } = require('./content');

const SEATS = 4;
const ROUNDS = 8;
const BLOOD = 4;
const START_HAND = 5;
const ALLOWANCE = 3;          // Fortune each heir starts with
const DRAW_PER_TURN = 2;
const PLAYS_PER_TURN = 2;
const HAND_LIMIT = 7;
const BLACKMAIL_TAKE = 3;
const ARREST_FINE = 3;
const INFAMY_BONUS = 4;
const MURDER_INFAMY = 2;      // secret until the Reading
const BETRAYAL_INFAMY = 3;    // public
const MAX_MESSAGES = 300;
const MAX_MESSAGE_LENGTH = 500;

const DURATIONS = {
  live: { day: 45 * 1000, night: 30 * 1000, inquest: 30 * 1000 },
  timed: { day: 24 * 3600 * 1000, night: 24 * 3600 * 1000, inquest: 24 * 3600 * 1000 },
};

const PHASE_NAMES = { lobby: 'The Lobby', day: 'Day', night: 'Night', inquest: 'The Inquest', ended: 'The Reading' };

class GameError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// ---------------------------------------------------------------- helpers

function shuffle(list, rng) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
const pickOne = (list, rng) => list[Math.floor(rng() * list.length)];
const card = (c) => CARDS[c.t];
const cardName = (c) => (CARDS[c.t].kind === 'inheritance' ? `Bequest (${CARDS[c.t].value})` : CARDS[c.t].name);

const find = (t, userId) => t.players.find((p) => p.userId === userId) || null;
const living = (t) => t.players.filter((p) => p.alive);
const estateValue = (p) => p.estate.reduce((n, c) => n + (card(c).value || 0), 0);
const fortune = (p) => estateValue(p) + p.coins;

/** The next living heir clockwise from `p` (not `p` itself, unless alone). */
function leftOf(t, p) {
  const i = t.players.indexOf(p);
  for (let k = 1; k <= t.players.length; k += 1) {
    const q = t.players[(i + k) % t.players.length];
    if (q.alive) return q;
  }
  return p;
}

function addEvent(t, now, type, text, extra = {}) {
  t.seq += 1;
  t.events.push({ id: t.seq, round: t.round, phase: t.phase, type, text, at: now, ...extra });
}

function draw(t, p, n, rng) {
  for (let i = 0; i < n; i += 1) {
    if (!t.deck.length) {
      if (!t.discard.length) return;
      t.deck = shuffle(t.discard, rng);
      t.discard = [];
    }
    p.hand.push(t.deck.pop());
  }
}

function discardRandom(t, p, n, rng) {
  const dropped = [];
  for (let i = 0; i < n && p.hand.length; i += 1) {
    const [c] = p.hand.splice(Math.floor(rng() * p.hand.length), 1);
    t.discard.push(c);
    dropped.push(c);
  }
  return dropped;
}

function takeFromHand(p, cardId) {
  const i = p.hand.findIndex((c) => c.id === cardId);
  if (i < 0) throw new GameError('That card is not in your hand.');
  return p.hand.splice(i, 1)[0];
}

function requirePlayer(t, userId) {
  const p = find(t, userId);
  if (!p) throw new GameError('You do not have a seat at this table.', 403);
  return p;
}

function requireLivingTarget(t, p, targetId) {
  const target = find(t, targetId);
  if (!target || !target.alive) throw new GameError('Choose a living heir.');
  if (target === p) throw new GameError('Choose another heir.');
  return target;
}

// ---------------------------------------------------------------- the table

function newTable({ id, code, name, host, mode = 'live', visibility = 'private', now }) {
  const t = {
    kind: 'cards',
    id, code, name,
    hostId: host.userId,
    createdAt: now,
    mode: mode === 'timed' ? 'timed' : 'live',
    visibility: visibility === 'public' ? 'public' : 'private',
    invites: [],
    status: 'lobby',
    phase: 'lobby',
    round: 0,
    startSeat: 0,
    turnOrder: [],
    turnIdx: 0,
    plays: 0,
    phaseEndsAt: null,
    players: [],
    deck: [],
    discard: [],
    shadows: {},
    lastNight: {},
    nightHistory: [],
    votes: {},
    pactOffers: [],
    events: [],
    messages: { table: [], whispers: [] },
    winner: null,
    standings: null,
    endedAt: null,
    seq: 0,
  };
  addPlayer(t, host);
  return t;
}

function addPlayer(t, { userId, name, isBot = false }) {
  if (t.status !== 'lobby') throw new GameError('This game has already started. No late joiners.', 409);
  const existing = find(t, userId);
  if (existing) return existing;
  if (t.players.length >= SEATS) throw new GameError(`This table is full (${SEATS} heirs).`, 409);
  const p = {
    userId, name, isBot,
    alive: true, blood: BLOOD,
    hand: [], estate: [],
    coins: 0, infamy: 0, secretInfamy: 0, suspicion: 0,
    bodyguards: 0, poisoned: false, poisonedRound: null, poisonedBy: null,
    arrested: false, pactWith: null,
    diedRound: null, killedBy: null, killedWith: null,
  };
  t.players.push(p);
  t.invites = (t.invites || []).filter((i) => i.userId !== userId);
  return p;
}

function removePlayer(t, userId) {
  if (t.status !== 'lobby') throw new GameError('You cannot leave once the game has started.', 409);
  if (userId === t.hostId) throw new GameError('The host cannot leave their own table.', 409);
  t.players = t.players.filter((p) => p.userId !== userId);
}

function addBots(t, actorId, count, rng) {
  if (actorId !== t.hostId) throw new GameError('Only the host can seat bots.', 403);
  if (t.status !== 'lobby') throw new GameError('Bots can only be seated before the game starts.', 409);
  if (t.players.length >= SEATS) throw new GameError('The table is full.', 409);
  const n = Math.max(1, Math.min(Number(count) || 1, SEATS - t.players.length));
  const taken = new Set(t.players.map((p) => p.name));
  const names = shuffle(BOT_NAMES, rng).filter((nm) => !taken.has(nm));
  for (let i = 0; i < n; i += 1) {
    t.seq += 1;
    addPlayer(t, { userId: `bot:${t.seq}`, name: names[i] || `Guest ${t.seq}`, isBot: true });
  }
}

function invitePlayer(t, actorId, user, now) {
  if (actorId !== t.hostId) throw new GameError('Only the host can send invitations.', 403);
  if (t.status !== 'lobby') throw new GameError('The game has started. No late joiners.', 409);
  if (find(t, user.id)) throw new GameError(`${user.name} already has a seat.`, 409);
  if (t.players.length + t.invites.length >= SEATS) throw new GameError(`A table seats ${SEATS}, counting open invitations.`, 409);
  if (!t.invites.some((i) => i.userId === user.id)) t.invites.push({ userId: user.id, name: user.name, at: now });
}

const isInvited = (t, userId) => (t.invites || []).some((i) => i.userId === userId);
function withdrawInvite(t, userId) { t.invites = (t.invites || []).filter((i) => i.userId !== userId); }

// ---------------------------------------------------------------- flow

function setDeadline(t, phase, ctx) {
  t.phaseEndsAt = ctx.now + DURATIONS[t.mode][phase];
}

function startGame(t, actorId, ctx) {
  if (actorId !== t.hostId) throw new GameError('Only the host can deal.', 403);
  if (t.status !== 'lobby') throw new GameError('The game has already started.', 409);
  if (t.players.length !== SEATS) throw new GameError(`The game needs exactly ${SEATS} heirs. Invite friends or seat bots.`, 409);

  t.players = shuffle(t.players, ctx.rng); // seating order
  let n = 0;
  const deck = [];
  for (const [type, def] of Object.entries(CARDS)) {
    for (let i = 0; i < def.count; i += 1) { n += 1; deck.push({ id: `k${n}`, t: type }); }
  }
  t.deck = shuffle(deck, ctx.rng);
  t.discard = [];
  for (const p of t.players) { draw(t, p, START_HAND, ctx.rng); p.coins = ALLOWANCE; }
  t.status = 'active';
  t.invites = [];
  t.round = 1;
  t.startSeat = 0;
  addEvent(t, ctx.now, 'welcome',
    `The heirs gather for the reading of the will: ${t.players.map((p) => p.name).join(', ')}. It will be read after ${ROUNDS} nights. The richest heir still breathing inherits everything.`);
  beginDay(t, ctx);
  settle(t, ctx);
}

function beginDay(t, ctx) {
  t.phase = 'day';
  // Snake order (1-2-3-4, then 4-3-2-1, ...), shifted each pair of rounds, so
  // whoever moves last in one round moves first in the next.
  const order = [];
  for (let k = 0; k < t.players.length; k += 1) {
    const p = t.players[(t.startSeat + k) % t.players.length];
    if (p.alive) order.push(p.userId);
  }
  if (t.round % 2 === 0) order.reverse();
  t.turnOrder = order;
  t.turnIdx = 0;
  addEvent(t, ctx.now, 'phase', `Round ${t.round} of ${ROUNDS}. Day breaks over the Club.`);
  beginTurn(t, ctx);
}

const currentTurn = (t) => (t.phase === 'day' ? find(t, t.turnOrder[t.turnIdx]) : null);

function beginTurn(t, ctx) {
  const p = currentTurn(t);
  t.plays = 0;
  draw(t, p, DRAW_PER_TURN, ctx.rng);
  setDeadline(t, 'day', ctx);
}

function endTurn(t, ctx) {
  const p = currentTurn(t);
  if (p.hand.length > HAND_LIMIT) {
    const dropped = discardRandom(t, p, p.hand.length - HAND_LIMIT, ctx.rng);
    addEvent(t, ctx.now, 'scheme', `${p.name} could only keep ${HAND_LIMIT} cards and dropped ${dropped.length}.`);
  }
  t.turnIdx += 1;
  if (t.turnIdx < t.turnOrder.length) beginTurn(t, ctx);
  else beginNight(t, ctx);
}

/** Heirs who must play into the Shadows tonight. */
const nightActors = (t) => living(t).filter((p) => !p.arrested && p.hand.length > 0);

function beginNight(t, ctx) {
  t.phase = 'night';
  t.shadows = {};
  setDeadline(t, 'night', ctx);
  const out = living(t).filter((p) => p.arrested);
  addEvent(t, ctx.now, 'phase', `Night falls. Every heir plays one card face down into the Shadows.${out.length ? ` ${out.map((p) => p.name).join(' and ')} spend${out.length === 1 ? 's' : ''} the night in a locked cell.` : ''}`);
}

function beginInquest(t, ctx) {
  t.phase = 'inquest';
  t.votes = {};
  setDeadline(t, 'inquest', ctx);
  addEvent(t, ctx.now, 'phase', 'The Inquest is called. Vote to accuse an heir. A majority means arrest.');
}

/**
 * Run every step that no longer needs a human: bot moves, and phases that
 * everyone has finished early. Called after every action and every tick.
 */
function settle(t, ctx) {
  for (let guard = 0; guard < 200 && t.status === 'active'; guard += 1) {
    if (t.phase === 'day') {
      const p = currentTurn(t);
      if (p.isBot) { botDay(t, p, ctx); endTurn(t, ctx); continue; }
      break;
    }
    if (t.phase === 'night') {
      for (const p of nightActors(t)) if (p.isBot && !t.shadows[p.userId]) botNight(t, p, ctx);
      if (nightActors(t).every((p) => t.shadows[p.userId])) { resolveNight(t, ctx); continue; }
      break;
    }
    if (t.phase === 'inquest') {
      for (const p of living(t)) if (p.isBot && !(p.userId in t.votes)) botVote(t, p, ctx);
      if (living(t).every((p) => p.userId in t.votes)) { resolveInquest(t, ctx); continue; }
      break;
    }
    break;
  }
}

/** Handle a passed deadline, then settle. Returns true if anything changed. */
function tick(t, ctx) {
  let changed = false;
  for (let guard = 0; guard < 50; guard += 1) {
    if (t.status !== 'active' || t.phaseEndsAt == null || ctx.now < t.phaseEndsAt) break;
    changed = true;
    if (t.phase === 'day') {
      addEvent(t, ctx.now, 'timeout', `${currentTurn(t).name} ran out of time.`);
      endTurn(t, ctx);
    } else if (t.phase === 'night') {
      resolveNight(t, ctx);
    } else if (t.phase === 'inquest') {
      resolveInquest(t, ctx);
    }
    settle(t, ctx);
  }
  return changed;
}

// ---------------------------------------------------------------- day

function playCard(t, userId, cardId, targetId, ctx) {
  const p = requirePlayer(t, userId);
  if (t.status !== 'active' || t.phase !== 'day') throw new GameError('Cards are played in the Day. At Night, use the Shadows.', 409);
  if (currentTurn(t) !== p) throw new GameError('It is not your turn.', 409);
  if (t.plays >= PLAYS_PER_TURN) throw new GameError(`You have played ${PLAYS_PER_TURN} cards this turn. End your turn.`, 409);
  const c = p.hand.find((x) => x.id === cardId);
  if (!c) throw new GameError('That card is not in your hand.');
  const def = card(c);
  if (def.phase !== 'day') throw new GameError(`${def.name} is played at Night, into the Shadows.`);
  const target = def.target ? requireLivingTarget(t, p, targetId) : null;
  if (c.t === 'forgery') {
    if (!p.estate.length) throw new GameError('You need a bequest of your own to swap.');
    if (!target.estate.length) throw new GameError(`${target.name} has no bequests to steal.`);
  }
  takeFromHand(p, cardId);
  applyDayCard(t, p, c, target, ctx);
  t.plays += 1;
  settle(t, ctx);
}

function applyDayCard(t, p, c, target, ctx) {
  const ev = (text, extra) => addEvent(t, ctx.now, 'scheme', text, extra);
  const used = () => t.discard.push(c);
  switch (c.t) {
    case 'bequest1': case 'bequest2': case 'bequest3': case 'bequest4':
      p.estate.push(c);
      ev(`${p.name} slipped a bequest into their Estate.`);
      return;
    case 'bodyguard':
      p.bodyguards += 1; used();
      ev(`${p.name} hired a Bodyguard.`);
      return;
    case 'antidote':
      used();
      if (p.poisoned) { p.poisoned = false; ev(`${p.name} took an Antidote and purged the poison.`); }
      else if (p.blood < BLOOD) { p.blood += 1; ev(`${p.name} took an Antidote and recovered 1 Blood.`); }
      else ev(`${p.name} took an Antidote. It tasted of nothing.`);
      return;
    case 'blackmail': {
      used();
      const take = Math.max(0, Math.min(BLACKMAIL_TAKE, fortune(target)));
      target.coins -= take;
      p.coins += take;
      p.infamy += 1;
      p.suspicion += 1;
      ev(`${p.name} blackmailed ${target.name} for ${take} Fortune.`);
      return;
    }
    case 'frame': {
      used();
      const moved = Math.min(2, p.suspicion);
      p.suspicion -= moved;
      target.suspicion += 2;
      ev(`${p.name} framed ${target.name}. ${target.name} now looks very suspicious.`);
      return;
    }
    case 'forgery': {
      used();
      const mine = p.estate.reduce((lo, x) => (card(x).value < card(lo).value ? x : lo));
      const theirs = pickOne(target.estate, ctx.rng);
      p.estate[p.estate.indexOf(mine)] = theirs;
      target.estate[target.estate.indexOf(theirs)] = mine;
      ev(`${p.name} forged the will, swapping a bequest with ${target.name}.`);
      return;
    }
    case 'search': {
      used();
      const last = t.lastNight[target.userId];
      const hand = target.hand.map(cardName).join(', ') || 'nothing';
      ev(`${p.name} searched ${target.name}'s room.`);
      ev(`Search: ${target.name} holds ${hand}. Last night they played ${last ? `${last.name}${last.targetName ? ` at ${last.targetName}` : ''}` : 'nothing'} into the Shadows.`,
        { to: [p.userId], private: true });
      return;
    }
    case 'pickpocket': {
      used();
      if (!target.hand.length) { ev(`${p.name} picked ${target.name}'s pocket and found it empty.`); return; }
      const [stolen] = target.hand.splice(Math.floor(ctx.rng() * target.hand.length), 1);
      p.hand.push(stolen);
      ev(`${p.name} picked ${target.name}'s pocket.`);
      ev(`Pickpocket: you took ${cardName(stolen)} from ${target.name}.`, { to: [p.userId], private: true });
      ev(`Pickpocket: ${p.name} took your ${cardName(stolen)}.`, { to: [target.userId], private: true });
      return;
    }
    case 'powercut': {
      used();
      const alive = living(t);
      const hands = alive.map((x) => x.hand);
      alive.forEach((x) => { leftOf(t, x).hand = hands[alive.indexOf(x)]; });
      ev(`${p.name} cut the power. In the dark, every hand passed to the left.`);
      return;
    }
    case 'fire': {
      used();
      for (const x of living(t)) discardRandom(t, x, 2, ctx.rng);
      ev(`${p.name} set the library alight. Every heir lost 2 cards in the smoke.`);
      return;
    }
    default:
      throw new GameError('That card cannot be played now.');
  }
}

function endTurnAction(t, userId, ctx) {
  const p = requirePlayer(t, userId);
  if (t.status !== 'active' || t.phase !== 'day' || currentTurn(t) !== p) throw new GameError('It is not your turn.', 409);
  endTurn(t, ctx);
  settle(t, ctx);
}

// ---------------------------------------------------------------- pacts

function pact(t, userId, op, targetId, ctx) {
  const p = requirePlayer(t, userId);
  if (t.status !== 'active') throw new GameError('Pacts are made during the game.', 409);
  if (!p.alive) throw new GameError('The dead make no pacts.', 403);
  if (op === 'break') {
    if (!p.pactWith) throw new GameError('You have no Pact to break.');
    const partner = find(t, p.pactWith);
    p.pactWith = null;
    if (partner) partner.pactWith = null;
    addEvent(t, ctx.now, 'pact', `${p.name} broke their Pact with ${partner ? partner.name : 'their partner'}.`);
    return;
  }
  const other = requireLivingTarget(t, p, targetId);
  if (op === 'propose') {
    if (p.pactWith) throw new GameError('Break your current Pact first.');
    if (other.pactWith) throw new GameError(`${other.name} already has a Pact.`);
    if (t.pactOffers.some((o) => o.from === p.userId && o.to === other.userId)) return;
    t.pactOffers.push({ from: p.userId, to: other.userId });
    addEvent(t, ctx.now, 'pact', `${p.name} offered ${other.name} a Pact.`);
    if (other.isBot && !other.pactWith && ctx.rng() < 0.5) acceptPact(t, other, p, ctx);
    return;
  }
  if (op === 'accept') {
    if (!t.pactOffers.some((o) => o.from === other.userId && o.to === p.userId)) throw new GameError(`${other.name} has not offered you a Pact.`);
    if (p.pactWith || other.pactWith) throw new GameError('One of you already has a Pact.', 409);
    acceptPact(t, p, other, ctx);
    return;
  }
  if (op === 'decline') {
    t.pactOffers = t.pactOffers.filter((o) => !(o.from === other.userId && o.to === p.userId));
    addEvent(t, ctx.now, 'pact', `${p.name} refused ${other.name}'s Pact.`);
    return;
  }
  throw new GameError('Unknown Pact action.');
}

function acceptPact(t, p, other, ctx) {
  p.pactWith = other.userId;
  other.pactWith = p.userId;
  t.pactOffers = t.pactOffers.filter((o) => ![o.from, o.to].some((u) => u === p.userId || u === other.userId));
  addEvent(t, ctx.now, 'pact', `${other.name} and ${p.name} have sealed a Pact. Their Alibis now cover each other.`);
}

// ---------------------------------------------------------------- night

function playNight(t, userId, cardId, targetId) {
  const p = requirePlayer(t, userId);
  if (t.status !== 'active' || t.phase !== 'night') throw new GameError('It is not night yet.', 409);
  if (!p.alive) throw new GameError('The dead do not walk the halls.', 403);
  if (p.arrested) throw new GameError('You are locked in a cell tonight.', 403);
  if (t.shadows[userId]) throw new GameError('You have already played into the Shadows tonight.', 409);
  const c = p.hand.find((x) => x.id === cardId);
  if (!c) throw new GameError('That card is not in your hand.');
  let target = null;
  if (card(c).kind === 'weapon') target = requireLivingTarget(t, p, targetId).userId;
  takeFromHand(p, cardId);
  t.shadows[userId] = { userId, card: c, target };
}

function resolveNight(t, ctx) {
  const rng = ctx.rng;
  // Anyone who did not play loses a random card into the Shadows as a bluff.
  for (const p of nightActors(t)) {
    if (!t.shadows[p.userId]) {
      const [c] = p.hand.splice(Math.floor(rng() * p.hand.length), 1);
      t.shadows[p.userId] = { userId: p.userId, card: c, target: null, timedOut: true };
    }
  }
  const plays = Object.values(t.shadows);
  t.nightHistory.push({ round: t.round, plays: plays.map((s) => ({ name: find(t, s.userId).name, card: cardName(s.card), target: s.target ? find(t, s.target).name : null, timedOut: Boolean(s.timedOut) })) });
  t.lastNight = Object.fromEntries(plays.map((s) => [s.userId, { name: cardName(s.card), targetName: s.target ? find(t, s.target).name : null }]));

  // Defenses.
  const def = new Map(living(t).map((p) => [p.userId, { locked: false, alibis: 0, passage: false }]));
  for (const s of plays.filter((x) => !x.timedOut)) {
    const d = def.get(s.userId);
    if (s.card.t === 'lockeddoor') d.locked = true;
    if (s.card.t === 'passage') d.passage = true;
    if (s.card.t === 'alibi') {
      d.alibis += 1;
      const partner = find(t, find(t, s.userId).pactWith);
      if (partner && partner.alive) def.get(partner.userId).alibis += 1;
    }
  }

  // Attacks, in random order.
  const notes = new Map(); // target name → lines
  const note = (who, line) => { if (!notes.has(who)) notes.set(who, []); notes.get(who).push(line); };
  // A card played for an heir who ran out of time is only ever a bluff.
  for (const s of shuffle(plays.filter((x) => card(x.card).kind === 'weapon' && x.target), rng)) {
    const attacker = find(t, s.userId);
    let target = find(t, s.target);
    const weapon = card(s.card);
    if (!target.alive) continue;
    const d = def.get(target.userId);
    if (d.passage) {
      d.passage = false;
      const next = leftOf(t, target);
      note(target.name, `Someone came for ${target.name} with the ${weapon.name}, but slipped into a Secret Passage and came out at ${next.name}'s door.`);
      target = next;
    }
    const dt = def.get(target.userId);
    if (dt.locked) { note(target.name, `Someone tried ${target.name}'s door with the ${weapon.name} in hand. It was locked.`); continue; }
    if (dt.alibis > 0) { dt.alibis -= 1; note(target.name, `Someone came for ${target.name} with the ${weapon.name}, but ${target.name} had an Alibi.`); continue; }
    strike(t, attacker, target, s.card, ctx, note);
  }
  for (const s of plays) t.discard.push(s.card);
  t.shadows = {};

  // Dawn: earlier poison takes its second wound.
  for (const p of living(t)) {
    if (p.poisoned && p.poisonedRound < t.round && p.blood > 0) {
      p.blood -= 1;
      p.poisoned = false;
      note(p.name, `${p.name} woke up green. The poison took 1 more Blood.`);
      if (p.blood <= 0) { p.killedBy = p.poisonedBy; p.killedWith = 'Poison'; }
    }
  }
  for (const p of t.players) if (p.arrested) p.arrested = false; // they served their night

  const lines = [...notes.values()].flat();
  addEvent(t, ctx.now, 'night', lines.length ? lines.join(' ') : 'The night passed without a sound. Every heir came down to breakfast.');

  for (const p of t.players) {
    if (p.alive && p.blood <= 0) {
      p.alive = false;
      p.diedRound = t.round;
      t.discard.push(...p.hand, ...p.estate);
      p.hand = [];
      p.estate = [];
      const partner = find(t, p.pactWith);
      if (partner) partner.pactWith = null;
      p.pactWith = null;
      const killer = find(t, p.killedBy);
      if (killer && killer !== p) killer.secretInfamy += MURDER_INFAMY;
      addEvent(t, ctx.now, 'murder', murderNotice(p.name, p.killedWith || 'mystery', rng), { victim: p.name });
    }
  }
  t.pactOffers = t.pactOffers.filter((o) => find(t, o.from).alive && find(t, o.to).alive);

  if (checkLastStanding(t, ctx)) return;
  beginInquest(t, ctx);
}

function strike(t, attacker, target, c, ctx, note) {
  const weapon = card(c);
  let wounds = weapon.wounds;
  const stab = attacker.pactWith === target.userId;
  if (stab) wounds *= 2;
  const bypass = c.t === 'poison' || (c.t === 'rope' && target.blood === 1);
  let absorbed = 0;
  if (!bypass && target.bodyguards > 0) {
    absorbed = Math.min(target.bodyguards, wounds);
    target.bodyguards -= absorbed;
    wounds -= absorbed;
  }
  target.blood -= wounds;
  const who = c.t === 'revolver' || stab ? attacker.name : 'Someone';
  let line = `${who} attacked ${target.name} with the ${weapon.name}`;
  line += wounds ? ` (${wounds} wound${wounds === 1 ? '' : 's'})` : '';
  line += absorbed ? `; a Bodyguard took ${absorbed === 1 ? 'the blow' : `${absorbed} blows`}` : '';
  line += '.';
  if (c.t === 'poison' && target.blood > 0) {
    target.poisoned = true;
    target.poisonedRound = t.round;
    target.poisonedBy = attacker.userId;
    line += ` ${target.name} has been poisoned.`;
  }
  if (c.t === 'candlestick') {
    const n = discardRandom(t, target, 2, ctx.rng).length;
    if (n) line += ` ${target.name} dropped ${n} card${n === 1 ? '' : 's'}.`;
  }
  if (c.t === 'revolver') {
    attacker.suspicion += 2;
    line += ' The whole house heard the shot.';
  }
  if (stab) {
    attacker.infamy += BETRAYAL_INFAMY;
    attacker.pactWith = null;
    target.pactWith = null;
    line += ` It was a stab in the back: ${attacker.name} betrayed their own Pact.`;
  }
  note(target.name, line);
  if (target.blood <= 0 && !target.killedBy) {
    target.killedBy = attacker.userId;
    target.killedWith = weapon.name;
  }
}

// ---------------------------------------------------------------- inquest

function castVote(t, userId, targetId) {
  const p = requirePlayer(t, userId);
  if (t.status !== 'active' || t.phase !== 'inquest') throw new GameError('The Inquest is not in session.', 409);
  if (!p.alive) throw new GameError('The dead cannot vote.', 403);
  if (targetId === null || targetId === '') { t.votes[userId] = null; return; } // abstain
  const target = requireLivingTarget(t, p, targetId);
  t.votes[userId] = target.userId;
}

function resolveInquest(t, ctx) {
  const alive = living(t);
  const tally = new Map();
  for (const p of alive) {
    const v = t.votes[p.userId];
    if (v) tally.set(v, (tally.get(v) || 0) + 1);
  }
  const needed = Math.floor(alive.length / 2) + 1;
  const ballots = alive.map((p) => ({ voter: p.name, target: t.votes[p.userId] ? find(t, t.votes[p.userId]).name : null }));
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= needed) {
    const accused = find(t, top[0]);
    const fine = Math.max(0, Math.min(ARREST_FINE, fortune(accused)));
    accused.coins -= fine;
    t.discard.push(...accused.hand);
    accused.hand = [];
    accused.arrested = true;
    accused.suspicion = 0;
    addEvent(t, ctx.now, 'inquest', `${accused.name} is arrested with ${top[1]} votes: fined ${fine} Fortune, stripped of every card, and locked up for the night.`, { ballots });
  } else {
    addEvent(t, ctx.now, 'inquest', `No majority (${needed} votes needed). Everyone walks free — for now.`, { ballots });
  }
  t.votes = {};
  if (t.round >= ROUNDS) { readTheWill(t, ctx); return; }
  t.round += 1;
  if (t.round % 2 === 1) t.startSeat = (t.startSeat + 1) % t.players.length;
  beginDay(t, ctx);
}

// ---------------------------------------------------------------- endings

function checkLastStanding(t, ctx) {
  const alive = living(t);
  if (alive.length > 1) return false;
  if (alive.length === 1) {
    addEvent(t, ctx.now, 'end', `${alive[0].name} is the last heir standing, and inherits everything.`);
    finish(t, ctx, alive[0], 'last');
  } else {
    addEvent(t, ctx.now, 'end', 'Not one heir survived the night. By the terms of the will, the entire estate goes to the cat.');
    finish(t, ctx, null, 'none');
  }
  return true;
}

function readTheWill(t, ctx) {
  const alive = living(t);
  const infamy = (p) => p.infamy + p.secretInfamy;
  const most = Math.max(...alive.map(infamy));
  const bonus = most > 0 ? alive.filter((p) => infamy(p) === most) : [];
  for (const p of bonus) p.coins += INFAMY_BONUS;
  // Most Fortune wins; then the less suspicious heir; a dead heat is settled by lot.
  const ranked = shuffle(alive, ctx.rng).sort((a, b) => fortune(b) - fortune(a) || a.suspicion - b.suspicion);
  const winner = ranked[0];
  addEvent(t, ctx.now, 'end',
    `The will is read. ${bonus.length ? `The Club rewards ruthlessness: ${bonus.map((p) => p.name).join(' and ')} ${bonus.length === 1 ? 'gains' : 'gain'} ${INFAMY_BONUS} Fortune for ${most} Infamy. ` : ''}`
    + `${ranked.map((p) => `${p.name} ${fortune(p)}`).join(', ')}. ${winner.name} inherits everything.`);
  finish(t, ctx, winner, 'reading');
}

function finish(t, ctx, winner, how) {
  const alive = living(t).sort((a, b) => fortune(b) - fortune(a) || a.suspicion - b.suspicion);
  if (winner) alive.unshift(...alive.splice(alive.indexOf(winner), 1));
  const dead = t.players.filter((p) => !p.alive).sort((a, b) => b.diedRound - a.diedRound);
  t.standings = [...alive, ...dead].map((p, i) => ({
    place: i + 1, userId: p.userId, name: p.name, alive: p.alive, fortune: p.alive ? fortune(p) : 0,
    infamy: p.infamy + p.secretInfamy, diedRound: p.diedRound,
    killedBy: p.killedBy ? (find(t, p.killedBy) || {}).name : null, killedWith: p.killedWith,
  }));
  t.winner = winner ? winner.userId : null;
  t.winHow = how;
  t.status = 'ended';
  t.phase = 'ended';
  t.phaseEndsAt = null;
  t.endedAt = ctx.now;
}

// ---------------------------------------------------------------- bots

/** A plain, ruthless bot: bank money, hurt the leader, finish off the weak. */
function botDay(t, p, ctx) {
  const rng = ctx.rng;
  const others = shuffle(living(t).filter((x) => x !== p), rng); // shuffled so ties don't pick on one seat
  const richest = others.slice().sort((a, b) => (b.coins + b.estate.length * 2.5) - (a.coins + a.estate.length * 2.5))[0];
  for (let n = 0; n < PLAYS_PER_TURN; n += 1) {
    const has = (type) => p.hand.find((c) => c.t === type);
    let choice = null;
    let target = null;
    const bequest = p.hand.filter((c) => card(c).kind === 'inheritance').sort((a, b) => card(b).value - card(a).value)[0];
    if (has('antidote') && (p.poisoned || p.blood < BLOOD)) choice = has('antidote');
    else if (has('bodyguard') && p.bodyguards === 0) choice = has('bodyguard');
    else if (has('blackmail') && richest && fortune(richest) >= BLACKMAIL_TAKE && rng() < 0.5) { choice = has('blackmail'); target = richest; }
    else if (bequest) choice = bequest;
    else if (has('frame') && p.suspicion >= 2) { choice = has('frame'); target = richest; }
    else if (has('forgery') && p.estate.length && richest && richest.estate.length && p.estate.some((c) => card(c).value <= 2)) { choice = has('forgery'); target = richest; }
    else if (has('pickpocket')) { choice = has('pickpocket'); target = others.slice().sort((a, b) => b.hand.length - a.hand.length)[0]; }
    else if (has('search') && rng() < 0.3) { choice = has('search'); target = pickOne(others, rng); }
    if (!choice || (card(choice).target && !target)) break;
    takeFromHand(p, choice.id);
    applyDayCard(t, p, choice, target, ctx);
    t.plays += 1;
  }
  if (!p.pactWith && rng() < 0.08) {
    const partner = others.find((x) => !x.pactWith && !x.isBot);
    if (partner) pact(t, p.userId, 'propose', partner.userId, ctx);
  }
  for (const o of t.pactOffers.filter((x) => x.to === p.userId)) {
    if (!p.pactWith && !find(t, o.from).pactWith && rng() < 0.5) acceptPact(t, p, find(t, o.from), ctx);
  }
}

function botNight(t, p, ctx) {
  const rng = ctx.rng;
  const others = shuffle(living(t).filter((x) => x !== p), rng);
  const weapons = p.hand.filter((c) => card(c).kind === 'weapon');
  const guards = p.hand.filter((c) => ['lockeddoor', 'alibi', 'passage'].includes(c.t));
  if (guards.length && (p.blood <= 1 || (!weapons.length && rng() < 0.7))) {
    t.shadows[p.userId] = { userId: p.userId, card: takeFromHand(p, guards[0].id), target: null };
    return;
  }
  if (weapons.length) {
    const partner = find(t, p.pactWith);
    let pool = others.filter((x) => x !== partner);
    if (partner && (partner.blood <= 2 || !pool.length) && rng() < 0.4) pool = [partner]; // ruthless
    if (!pool.length) pool = others;
    const weakest = pool.slice().sort((a, b) => (a.blood - a.bodyguards) - (b.blood - b.bodyguards))[0];
    const richest = pool.slice().sort((a, b) => (b.coins + b.estate.length * 2.5) - (a.coins + a.estate.length * 2.5))[0];
    const roll = rng();
    const target = roll < 0.45 ? weakest : roll < 0.8 ? richest : pickOne(pool, rng);
    const w = weapons.sort((a, b) => card(b).wounds - card(a).wounds)[0];
    t.shadows[p.userId] = { userId: p.userId, card: takeFromHand(p, w.id), target: target.userId };
    return;
  }
  // Bluff with the least useful card.
  const rank = (c) => (card(c).kind === 'inheritance' ? 10 + card(c).value : card(c).kind === 'defense' ? 5 : 1);
  const bluff = p.hand.slice().sort((a, b) => rank(a) - rank(b))[0];
  t.shadows[p.userId] = { userId: p.userId, card: takeFromHand(p, bluff.id), target: null };
}

function botVote(t, p, ctx) {
  const others = living(t).filter((x) => x !== p);
  if (!others.length) { t.votes[p.userId] = null; return; }
  const top = Math.max(...others.map((x) => x.suspicion));
  const suspects = others.filter((x) => x.suspicion === top);
  t.votes[p.userId] = top === 0 && ctx.rng() < 0.5 ? null : pickOne(suspects, ctx.rng).userId;
}

// ---------------------------------------------------------------- chat

function postMessage(t, userId, channel, text, toId, now) {
  const p = requirePlayer(t, userId);
  const body = String(text || '').trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!body) throw new GameError('Say something.');
  if (t.status === 'active' && !p.alive) throw new GameError('The dead keep their own counsel.', 403);
  t.seq += 1;
  if (channel === 'whisper') {
    const to = find(t, toId);
    if (!to || to === p) throw new GameError('Whisper to another heir.');
    if (t.status === 'active' && !to.alive) throw new GameError('They cannot hear you now.');
    t.messages.whispers.push({ id: t.seq, from: p.userId, fromName: p.name, to: to.userId, toName: to.name, text: body, at: now });
    if (t.messages.whispers.length > MAX_MESSAGES) t.messages.whispers.splice(0, t.messages.whispers.length - MAX_MESSAGES);
    return;
  }
  if (channel !== 'table') throw new GameError('Unknown channel.');
  t.messages.table.push({ id: t.seq, from: p.userId, fromName: p.name, text: body, at: now });
  if (t.messages.table.length > MAX_MESSAGES) t.messages.table.splice(0, t.messages.table.length - MAX_MESSAGES);
}

// ---------------------------------------------------------------- what an heir may see

const cardView = (c) => {
  const d = card(c);
  return { id: c.id, t: c.t, name: cardName(c), kind: d.kind, phase: d.phase, target: d.target, icon: d.icon, text: d.text, value: d.value || null };
};

function view(t, userId, now) {
  const me = find(t, userId);
  if (!me) throw new GameError('You do not have a seat at this table.', 403);
  const ended = t.status === 'ended';
  const current = currentTurn(t);
  const out = {
    now,
    kind: 'cards',
    id: t.id,
    code: t.visibility === 'public' || userId === t.hostId ? t.code : null,
    name: t.name,
    mode: t.mode,
    visibility: t.visibility,
    invites: userId === t.hostId ? t.invites.map((i) => ({ userId: i.userId, name: i.name })) : [],
    status: t.status,
    phase: t.phase,
    phaseName: PHASE_NAMES[t.phase],
    round: t.round,
    rounds: ROUNDS,
    phaseEndsAt: t.phaseEndsAt,
    isHost: userId === t.hostId,
    seats: SEATS,
    deckCount: t.deck.length,
    discardCount: t.discard.length,
    turn: current ? current.userId : null,
    playsLeft: current === me ? PLAYS_PER_TURN - t.plays : 0,
    winner: t.winner,
    winHow: t.winHow || null,
    standings: t.standings,
    nightHistory: ended ? t.nightHistory : [],
    me: {
      userId, name: me.name, alive: me.alive, blood: me.blood, poisoned: me.poisoned, arrested: me.arrested,
      hand: me.hand.map(cardView), estate: me.estate.map(cardView), estateValue: estateValue(me),
      coins: me.coins, fortune: fortune(me), infamy: me.infamy + me.secretInfamy, suspicion: me.suspicion,
      bodyguards: me.bodyguards, pactWith: me.pactWith,
      nightPlayed: t.shadows[userId] ? { card: cardView(t.shadows[userId].card), target: t.shadows[userId].target } : null,
      mustPlayNight: t.phase === 'night' && nightActors(t).includes(me),
      vote: userId in t.votes ? t.votes[userId] : undefined,
    },
    players: t.players.map((p) => ({
      userId: p.userId, name: p.name, isBot: p.isBot, isHost: p.userId === t.hostId,
      alive: p.alive, blood: p.blood, bodyguards: p.bodyguards, poisoned: p.poisoned, arrested: p.arrested,
      handCount: p.hand.length, estateCount: p.estate.length, coins: p.coins,
      estateValue: ended ? estateValue(p) : null,
      infamy: p.userId === userId || ended ? p.infamy + p.secretInfamy : p.infamy,
      suspicion: p.suspicion, pactWith: p.pactWith, diedRound: p.diedRound,
      playedTonight: t.phase === 'night' ? Boolean(t.shadows[p.userId]) : null,
      votedToday: t.phase === 'inquest' ? p.userId in t.votes : null,
    })),
    pactOffers: t.pactOffers.filter((o) => o.from === userId || o.to === userId),
    events: t.events.filter((e) => !e.to || e.to.includes(userId)).slice(-150).map(({ to, ...e }) => e),
    messages: {
      table: t.messages.table.slice(-150),
      whispers: t.messages.whispers.filter((w) => ended || w.from === userId || w.to === userId).slice(-150),
    },
    canChat: t.status !== 'active' || me.alive,
  };
  return out;
}

module.exports = {
  SEATS, ROUNDS, BLOOD, DURATIONS, PLAYS_PER_TURN, HAND_LIMIT,
  GameError, newTable, addPlayer, removePlayer, addBots, invitePlayer, isInvited, withdrawInvite,
  startGame, tick, settle, playCard, endTurnAction, pact, playNight, castVote, postMessage, view,
  find, fortune, currentTurn,
};
