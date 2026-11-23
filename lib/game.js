'use strict';

/**
 * The MurdrClub rules engine.
 *
 * A club is a plain JSON object. Every function here takes the club and a
 * context `{ now, rng }` and changes the club in place, so the whole game can
 * be played out in tests with a fake clock and a seeded random number source.
 * Nothing in this file knows about HTTP or storage.
 *
 * A day runs:  Errands (day) → The Tribunal → The Back Room → next morning.
 * In the Last Toast (5 or fewer alive) there are no more murders, so the
 * Back Room is skipped.
 */

const { phaseEnd } = require('./schedule');
const content = require('./content');

const MIN_PLAYERS = 4;
const RECOMMENDED_MIN_PLAYERS = 10;
const MAX_PLAYERS = 25;
const ENDGAME_AT = 5;
const MAX_STRIKES = 3;
const ERRAND_POINTS = 100;
const MAX_MESSAGES_PER_CHANNEL = 500;
const MAX_MESSAGE_LENGTH = 500;

const PHASE_NAMES = { lobby: 'The Lobby', day: 'Errands', tribunal: 'The Tribunal', backroom: 'The Back Room', ended: 'Closed' };

class GameError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function murdererCount(players) {
  if (players >= 20) return 4;
  if (players >= 14) return 3;
  if (players >= 10) return 2;
  return 1;
}

function shuffle(list, rng) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const pickOne = (list, rng) => list[Math.floor(rng() * list.length)];

// ---------------------------------------------------------------- creation

function newClub({ id, code, name, host, settings, now }) {
  const club = {
    id,
    code,
    name,
    hostId: host.userId,
    createdAt: now,
    settings,
    status: 'lobby',
    phase: 'lobby',
    day: 0,
    phaseStartedAt: now,
    phaseEndsAt: null,
    endgame: false,
    players: [],
    votes: {},
    toasts: {},
    murderVotes: {},
    errand: null,
    errandOrder: [],
    vault: 0,
    messages: { lounge: [], backroom: [], cellar: [] },
    events: [],
    winner: null,
    payout: null,
    endedAt: null,
    seq: 0,
  };
  addPlayer(club, host);
  return club;
}

function findPlayer(club, userId) {
  return club.players.find((p) => p.userId === userId) || null;
}

function requirePlayer(club, userId) {
  const p = findPlayer(club, userId);
  if (!p) throw new GameError('You are not a member of this club.', 403);
  return p;
}

function addPlayer(club, { userId, name, isBot = false }) {
  if (club.status !== 'lobby') throw new GameError('This club has already opened its doors. New members cannot join mid-season.', 409);
  if (findPlayer(club, userId)) return findPlayer(club, userId);
  if (club.players.length >= MAX_PLAYERS) throw new GameError(`This club is full (${MAX_PLAYERS} members).`, 409);
  const player = {
    userId, name, isBot,
    role: null,
    alive: true,
    eliminatedHow: null,
    eliminatedDay: null,
    revealed: false,
    strikes: 0,
    joinedAt: Date.now(),
  };
  club.players.push(player);
  return player;
}

function removePlayer(club, userId) {
  if (club.status !== 'lobby') throw new GameError('You cannot leave once the season has started.', 409);
  if (userId === club.hostId) throw new GameError('The host cannot leave their own club.', 409);
  club.players = club.players.filter((p) => p.userId !== userId);
}

function addBots(club, actorId, count, rng) {
  if (actorId !== club.hostId) throw new GameError('Only the host can invite practice bots.', 403);
  if (club.status !== 'lobby') throw new GameError('Bots can only be added before the season starts.', 409);
  const n = Math.max(1, Math.min(Number(count) || 1, MAX_PLAYERS - club.players.length));
  if (club.players.length >= MAX_PLAYERS) throw new GameError('The club is full.', 409);
  const taken = new Set(club.players.map((p) => p.name));
  const names = shuffle(content.BOT_NAMES, rng).filter((nm) => !taken.has(nm));
  for (let i = 0; i < n; i += 1) {
    const name = names[i] || `Guest ${club.players.length + 1}`;
    club.seq += 1;
    addPlayer(club, { userId: `bot:${club.seq}`, name, isBot: true });
  }
}

// ---------------------------------------------------------------- helpers

const alivePlayers = (club) => club.players.filter((p) => p.alive);
const aliveMurderers = (club) => club.players.filter((p) => p.alive && p.role === 'murderer');
const aliveMembers = (club) => club.players.filter((p) => p.alive && p.role === 'member');

function addEvent(club, now, type, text, data) {
  club.seq += 1;
  club.events.push({ id: club.seq, day: club.day, type, text, at: now, ...(data ? { data } : {}) });
}

function eliminate(club, player, how) {
  player.alive = false;
  player.eliminatedHow = how;
  player.eliminatedDay = club.day;
  // Blackballed and resigned players show their card. Murder victims are
  // always Members, because Murderers can only target Members.
  player.revealed = true;
}

const roleWord = (p) => (p.role === 'murderer' ? 'a Murderer' : 'a Member');

// ---------------------------------------------------------------- phases

function enterPhase(club, phase, start, opts = {}) {
  club.phase = phase;
  club.phaseStartedAt = start;
  club.phaseEndsAt = phaseEnd(club.settings, phase, start, opts);
  if (phase === 'day') {
    const order = club.errandOrder;
    club.errand = { index: order[(club.day - 1) % order.length], answers: {} };
  } else if (phase === 'tribunal') {
    club.votes = {};
    club.toasts = {};
  } else if (phase === 'backroom') {
    club.murderVotes = {};
  }
}

function startGame(club, actorId, ctx) {
  if (actorId !== club.hostId) throw new GameError('Only the host can open the club.', 403);
  if (club.status !== 'lobby') throw new GameError('The season has already started.', 409);
  const n = club.players.length;
  if (n < MIN_PLAYERS) throw new GameError(`You need at least ${MIN_PLAYERS} members to start (${RECOMMENDED_MIN_PLAYERS}+ is best). Invite friends or add practice bots.`, 409);

  const k = murdererCount(n);
  const order = shuffle(club.players.map((_, i) => i), ctx.rng);
  club.players.forEach((p) => { p.role = 'member'; });
  for (let i = 0; i < k; i += 1) club.players[order[i]].role = 'murderer';

  club.errandOrder = shuffle(content.ERRANDS.map((_, i) => i), ctx.rng);
  club.status = 'active';
  club.day = 1;
  enterPhase(club, 'day', ctx.now, { firstDay: true });
  addEvent(club, ctx.now, 'welcome',
    `Welcome to ${club.name}. ${n} members have checked in. ${k === 1 ? 'One of you is a Murderer' : `${k} of you are Murderers`}. Check your membership card, and trust no one.`);
}

/** Move to the next phase. `manual` means the host pressed "advance now". */
function advance(club, ctx, { manual = false } = {}) {
  if (club.status !== 'active') return;
  // A scheduled change starts the next phase where this one was due to end,
  // so a server that was briefly down catches up instead of drifting.
  const start = manual ? ctx.now : club.phaseEndsAt;

  if (club.phase === 'day') {
    closeErrand(club, ctx);
    enterPhase(club, 'tribunal', start);
    addEvent(club, ctx.now, 'phase', club.endgame
      ? 'The Tribunal is in session. Vote to blackball — and decide: Raise a Glass, or Pour Another?'
      : 'The Tribunal is in session. Cast your vote. It takes a majority of the living to blackball someone.');
    return;
  }

  if (club.phase === 'tribunal') {
    resolveTribunal(club, ctx);
    if (club.status !== 'active') return;
    maybeEnterEndgame(club, ctx);
    if (club.endgame) {
      club.day += 1;
      enterPhase(club, 'day', start);
      addEvent(club, ctx.now, 'morning', `Day ${club.day}. There are no more murders during the Last Toast. Only the Tribunal can decide now.`);
    } else {
      enterPhase(club, 'backroom', start);
      addEvent(club, ctx.now, 'phase', 'The lights go down. The Murderers gather in the Back Room.');
    }
    return;
  }

  if (club.phase === 'backroom') {
    club.day += 1;
    resolveMurder(club, ctx);
    if (club.status !== 'active') return;
    maybeEnterEndgame(club, ctx);
    enterPhase(club, 'day', start);
  }
}

/** Run every phase change that is now due. Returns true if anything changed. */
function tick(club, ctx) {
  let changed = false;
  for (let guard = 0; guard < 60; guard += 1) {
    if (club.status !== 'active' || club.phaseEndsAt == null || ctx.now < club.phaseEndsAt) break;
    advance(club, ctx);
    changed = true;
  }
  return changed;
}

function hostAdvance(club, actorId, ctx) {
  if (actorId !== club.hostId) throw new GameError('Only the host can end a phase early.', 403);
  if (club.status !== 'active') throw new GameError('The season is not running.', 409);
  advance(club, ctx, { manual: true });
}

// ---------------------------------------------------------------- errands

function closeErrand(club, ctx) {
  const errand = club.errand;
  if (!errand) return;
  const q = content.ERRANDS[errand.index];
  for (const p of alivePlayers(club)) {
    if (p.isBot && errand.answers[p.userId] === undefined) {
      errand.answers[p.userId] = ctx.rng() < 0.6 ? q.a : Math.floor(ctx.rng() * q.c.length);
    }
  }
  const answered = Object.keys(errand.answers).length;
  const right = Object.values(errand.answers).filter((a) => a === q.a).length;
  const earned = right * ERRAND_POINTS;
  club.vault += earned;
  addEvent(club, ctx.now, 'errand',
    `Errand complete. ${right} of ${answered} answered correctly ("${q.c[q.a]}"), adding ${earned.toLocaleString('en-US')} to the Vault.`);
  club.errand = { ...errand, closed: true };
}

function answerErrand(club, userId, choice) {
  const p = requirePlayer(club, userId);
  if (club.phase !== 'day' || !club.errand || club.errand.closed) throw new GameError('There is no Errand open right now.', 409);
  if (!p.alive) throw new GameError('The departed do not run Errands.', 403);
  if (club.errand.answers[userId] !== undefined) throw new GameError('You have already answered today’s Errand.', 409);
  const q = content.ERRANDS[club.errand.index];
  const c = Number(choice);
  if (!Number.isInteger(c) || c < 0 || c >= q.c.length) throw new GameError('Pick one of the answers.');
  club.errand.answers[userId] = c;
}

// ---------------------------------------------------------------- tribunal

function castVote(club, userId, targetId) {
  const p = requirePlayer(club, userId);
  if (club.phase !== 'tribunal') throw new GameError('The Tribunal is not in session.', 409);
  if (!p.alive) throw new GameError('The departed cannot vote.', 403);
  const t = findPlayer(club, targetId);
  if (!t || !t.alive) throw new GameError('Choose a living member.');
  if (t.userId === userId) throw new GameError('You cannot blackball yourself.');
  club.votes[userId] = targetId;
}

function castToast(club, userId, choice) {
  const p = requirePlayer(club, userId);
  if (club.phase !== 'tribunal' || !club.endgame) throw new GameError('The Last Toast has not begun.', 409);
  if (!p.alive) throw new GameError('The departed cannot raise a glass.', 403);
  if (choice !== 'raise' && choice !== 'pour') throw new GameError('Choose Raise a Glass or Pour Another.');
  club.toasts[userId] = choice;
}

function botTribunal(club, rng) {
  const living = alivePlayers(club);
  // Bots follow a shared rumour most of the time, like a real table does,
  // so majorities can actually form.
  const rumour = living.length ? pickOne(living, rng) : null;
  for (const p of living) {
    if (!p.isBot) continue;
    if (!club.votes[p.userId]) {
      const pool = living.filter((t) => t.userId !== p.userId && (p.role !== 'murderer' || t.role === 'member'));
      const choices = pool.length ? pool : living.filter((t) => t.userId !== p.userId);
      const follow = rumour && rng() < 0.65 && choices.includes(rumour);
      if (choices.length) club.votes[p.userId] = (follow ? rumour : pickOne(choices, rng)).userId;
    }
    if (club.endgame && !club.toasts[p.userId]) {
      club.toasts[p.userId] = p.role === 'murderer' || rng() < 0.4 ? 'raise' : 'pour';
    }
  }
}

function resolveTribunal(club, ctx) {
  botTribunal(club, ctx.rng);
  const living = alivePlayers(club);
  const name = (id) => (findPlayer(club, id) || {}).name || '?';

  if (club.endgame && living.length > 0 && living.every((p) => club.toasts[p.userId] === 'raise')) {
    addEvent(club, ctx.now, 'toast', `Every glass is raised. ${living.map((p) => p.name).join(', ')} close the season together.`);
    endGame(club, ctx, aliveMurderers(club).length ? 'murderers' : 'members');
    return;
  }

  const tally = new Map();
  for (const voter of living) {
    const target = club.votes[voter.userId];
    if (target) tally.set(target, (tally.get(target) || 0) + 1);
  }
  const ballots = living.filter((p) => club.votes[p.userId]).map((p) => ({ voter: p.name, target: name(club.votes[p.userId]) }));
  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  const topCount = ranked.length ? ranked[0][1] : 0;
  const top = ranked.filter(([, c]) => c === topCount).map(([id]) => id);

  let outId = null;
  if (club.endgame) {
    // In the Last Toast the Tribunal must remove someone: most votes, ties drawn by lot.
    if (top.length) outId = top.length === 1 ? top[0] : pickOne(top, ctx.rng);
  } else if (top.length === 1 && topCount > living.length / 2) {
    outId = top[0];
  }

  const needed = Math.floor(living.length / 2) + 1;
  const summary = { ballots, counts: ranked.map(([id, c]) => ({ name: name(id), votes: c })), needed: club.endgame ? null : needed };

  if (outId) {
    const out = findPlayer(club, outId);
    eliminate(club, out, 'blackballed');
    addEvent(club, ctx.now, 'verdict',
      `${out.name} has been blackballed with ${tally.get(outId)} vote${tally.get(outId) === 1 ? '' : 's'}. They turn over their card: they were ${roleWord(out)}.`,
      { ...summary, outcome: 'blackballed', role: out.role });
  } else {
    addEvent(club, ctx.now, 'verdict',
      topCount
        ? `The Club is Undecided. No one reached the ${needed} votes needed. Everyone stays — but the votes are on the record.`
        : 'The Club is Undecided. Not a single vote was cast.',
      { ...summary, outcome: 'undecided' });
  }

  // Strikes for anyone who did not vote. Three strikes and you are out.
  for (const p of living) {
    if (!p.alive || club.votes[p.userId]) continue;
    p.strikes += 1;
    if (p.strikes >= MAX_STRIKES) {
      eliminate(club, p, 'resigned');
      addEvent(club, ctx.now, 'resigned', `${p.name} missed ${MAX_STRIKES} Tribunals and has resigned their membership. They were ${roleWord(p)}.`, { role: p.role });
    }
  }

  checkWin(club, ctx);
}

// ---------------------------------------------------------------- back room

function castMurder(club, userId, targetId) {
  const p = requirePlayer(club, userId);
  if (club.phase !== 'backroom') throw new GameError('The Back Room is closed.', 409);
  if (p.role !== 'murderer' || !p.alive) throw new GameError('Only living Murderers may enter the Back Room.', 403);
  const t = findPlayer(club, targetId);
  if (!t || !t.alive || t.role !== 'member') throw new GameError('Choose a living Member.');
  club.murderVotes[userId] = targetId;
}

function resolveMurder(club, ctx) {
  const murderers = aliveMurderers(club);
  const members = aliveMembers(club);
  for (const m of murderers) {
    if (m.isBot && !club.murderVotes[m.userId] && members.length) {
      club.murderVotes[m.userId] = pickOne(members, ctx.rng).userId;
    }
  }
  const tally = new Map();
  for (const m of murderers) {
    const t = club.murderVotes[m.userId];
    if (t) tally.set(t, (tally.get(t) || 0) + 1);
  }
  if (!tally.size) {
    addEvent(club, ctx.now, 'morning', `Day ${club.day}. ${content.quietNight(ctx.rng)}`);
    return;
  }
  const max = Math.max(...tally.values());
  const top = [...tally.entries()].filter(([, c]) => c === max).map(([id]) => id);
  const victim = findPlayer(club, top.length === 1 ? top[0] : pickOne(top, ctx.rng));
  eliminate(club, victim, 'murdered');
  victim.eliminatedDay = club.day - 1; // killed during the previous night
  addEvent(club, ctx.now, 'murder', `Day ${club.day}. ${content.murderNotice(victim.name, ctx.rng)}`, { victim: victim.name });
  checkWin(club, ctx);
}

// ---------------------------------------------------------------- endings

function maybeEnterEndgame(club, ctx) {
  if (club.endgame || club.status !== 'active') return;
  if (alivePlayers(club).length <= ENDGAME_AT) {
    club.endgame = true;
    addEvent(club, ctx.now, 'endgame',
      'The Last Toast begins. No more murders. At each Tribunal you will blackball someone — unless every survivor chooses to Raise a Glass and end the season. If a Murderer is still among you when the glasses are raised, they take the Vault.');
  }
}

function checkWin(club, ctx) {
  if (club.status !== 'active') return;
  const m = aliveMurderers(club).length;
  const n = aliveMembers(club).length;
  if (m === 0) endGame(club, ctx, 'members');
  else if (n === 0 || (!club.endgame && m >= n)) endGame(club, ctx, 'murderers');
}

function endGame(club, ctx, winner) {
  club.status = 'ended';
  club.phase = 'ended';
  club.phaseEndsAt = null;
  club.winner = winner;
  club.endedAt = ctx.now;
  const winners = (winner === 'members' ? aliveMembers(club) : aliveMurderers(club));
  const share = winners.length ? Math.floor(club.vault / winners.length) : 0;
  club.payout = { winners: winners.map((p) => p.name), share };
  const vault = club.vault.toLocaleString('en-US');
  addEvent(club, ctx.now, 'end', winner === 'members'
    ? `Every Murderer has been unmasked. The Members win. ${winners.map((p) => p.name).join(', ')} share the Vault of ${vault} (${share.toLocaleString('en-US')} each).`
    : `The Murderers have won. ${winners.map((p) => p.name).join(', ')} walk out with the Vault of ${vault}${winners.length > 1 ? ` (${share.toLocaleString('en-US')} each)` : ''}.`);
}

// ---------------------------------------------------------------- chat

function canRead(club, player, channel) {
  if (club.status === 'ended') return true; // the season recap opens everything
  if (channel === 'lounge') return true;
  if (channel === 'backroom') return player.role === 'murderer';
  if (channel === 'cellar') return !player.alive;
  return false;
}

function canWrite(club, player, channel) {
  if (channel === 'lounge') return club.status !== 'active' || player.alive;
  if (club.status !== 'active') return false;
  if (channel === 'backroom') return player.role === 'murderer' && player.alive;
  if (channel === 'cellar') return !player.alive;
  return false;
}

function postMessage(club, userId, channel, text, now) {
  const p = requirePlayer(club, userId);
  if (!['lounge', 'backroom', 'cellar'].includes(channel)) throw new GameError('Unknown channel.');
  if (!canWrite(club, p, channel)) throw new GameError('You cannot speak in that room.', 403);
  const body = String(text || '').trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!body) throw new GameError('Say something.');
  club.seq += 1;
  const list = club.messages[channel];
  list.push({ id: club.seq, userId, name: p.name, text: body, at: now });
  if (list.length > MAX_MESSAGES_PER_CHANNEL) list.splice(0, list.length - MAX_MESSAGES_PER_CHANNEL);
}

// ---------------------------------------------------------------- what a player may see

/** The club as seen by one player: everything they are allowed to know, nothing more. */
function view(club, userId, now) {
  const me = findPlayer(club, userId);
  if (!me) throw new GameError('You are not a member of this club.', 403);
  const ended = club.status === 'ended';
  const iAmMurderer = me.role === 'murderer';

  const players = club.players.map((p) => {
    const showRole = ended || p.userId === userId || p.revealed || (iAmMurderer && p.role === 'murderer');
    return {
      userId: p.userId,
      name: p.name,
      isBot: p.isBot,
      isHost: p.userId === club.hostId,
      alive: p.alive,
      eliminatedHow: p.eliminatedHow,
      eliminatedDay: p.eliminatedDay,
      strikes: p.strikes,
      role: showRole ? p.role : null,
    };
  });

  const living = alivePlayers(club);
  const out = {
    now,
    id: club.id,
    code: club.code,
    name: club.name,
    status: club.status,
    phase: club.phase,
    phaseName: PHASE_NAMES[club.phase],
    day: club.day,
    phaseEndsAt: club.phaseEndsAt,
    endgame: club.endgame,
    settings: club.settings,
    vault: club.vault,
    winner: club.winner,
    payout: club.payout,
    isHost: userId === club.hostId,
    limits: { min: MIN_PLAYERS, recommended: RECOMMENDED_MIN_PLAYERS, max: MAX_PLAYERS, murderers: murdererCount(club.players.length) },
    me: { userId, name: me.name, role: me.role, alive: me.alive, strikes: me.strikes, eliminatedHow: me.eliminatedHow },
    players,
    alive: living.length,
    events: club.events.slice(-200),
    messages: {},
    action: null,
  };

  for (const ch of ['lounge', 'backroom', 'cellar']) {
    if (canRead(club, me, ch)) out.messages[ch] = club.messages[ch].slice(-200).map(({ id, name, text, at, userId: uid }) => ({ id, name, text, at, mine: uid === userId }));
  }
  out.canWrite = Object.fromEntries(['lounge', 'backroom', 'cellar'].map((ch) => [ch, canWrite(club, me, ch)]));

  if (club.status === 'active') {
    if (club.phase === 'day' && club.errand) {
      const q = content.ERRANDS[club.errand.index];
      out.action = {
        type: 'errand',
        question: q.q,
        choices: q.c,
        myAnswer: club.errand.answers[userId] ?? null,
        answered: Object.keys(club.errand.answers).length,
        points: ERRAND_POINTS,
      };
    } else if (club.phase === 'tribunal') {
      out.action = {
        type: 'tribunal',
        myVote: club.votes[userId] || null,
        myToast: club.toasts[userId] || null,
        votesCast: living.filter((p) => club.votes[p.userId]).length,
        needed: Math.floor(living.length / 2) + 1,
      };
    } else if (club.phase === 'backroom') {
      out.action = { type: 'backroom' };
      if (iAmMurderer) {
        out.action.myPick = club.murderVotes[userId] || null;
        out.action.picks = aliveMurderers(club).map((m) => ({ name: m.name, target: (findPlayer(club, club.murderVotes[m.userId]) || {}).name || null }));
      }
    }
  }
  return out;
}

module.exports = {
  MIN_PLAYERS, RECOMMENDED_MIN_PLAYERS, MAX_PLAYERS, ENDGAME_AT, MAX_STRIKES, ERRAND_POINTS,
  GameError, murdererCount, newClub, addPlayer, removePlayer, addBots, findPlayer,
  startGame, advance, tick, hostAdvance, answerErrand, castVote, castToast, castMurder,
  postMessage, view,
};
