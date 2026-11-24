'use strict';

/**
 * The cards, and the words the Proprietor uses. Kept apart from the rules so
 * the flavour can change without touching the engine.
 *
 * kind:   weapon | defense | scheme | inheritance
 * phase:  when it can be played for its effect: 'day' or 'night'.
 *         Any card can be played at Night face down as a bluff.
 * target: whether it is aimed at another heir.
 */

const CARDS = {
  // Weapons (20): played at Night, aimed at one heir. The attacker stays secret.
  dagger:      { name: 'Dagger',      kind: 'weapon', phase: 'night', target: true, count: 5, wounds: 1, icon: '\u{1F5E1}', text: '1 wound. Silent.' },
  poison:      { name: 'Poison',      kind: 'weapon', phase: 'night', target: true, count: 4, wounds: 1, icon: '☠', text: '1 wound, and 1 more at the next dawn unless cured. Slips past Bodyguards.' },
  candlestick: { name: 'Candlestick', kind: 'weapon', phase: 'night', target: true, count: 4, wounds: 1, icon: '\u{1F56F}', text: '1 wound. The victim drops 2 cards from their hand.' },
  rope:        { name: 'Rope',        kind: 'weapon', phase: 'night', target: true, count: 4, wounds: 1, icon: '➰', text: '1 wound. Against an heir on their last Blood, ignores Bodyguards.' },
  revolver:    { name: 'Revolver',    kind: 'weapon', phase: 'night', target: true, count: 3, wounds: 2, icon: '\u{1F52B}', text: '2 wounds. Loud: the shooter is revealed and gains 2 Suspicion.' },

  // Defenses (16)
  alibi:       { name: 'Alibi',          kind: 'defense', phase: 'night', target: false, count: 4, icon: '\u{1F4DC}', text: 'Night: cancel one attack on you. If you have a Pact, it covers your partner too.' },
  bodyguard:   { name: 'Bodyguard',      kind: 'defense', phase: 'day',   target: false, count: 4, icon: '\u{1F6E1}', text: 'Day: stands in front of you and takes the next wound.' },
  antidote:    { name: 'Antidote',       kind: 'defense', phase: 'day',   target: false, count: 3, icon: '\u{1F9EA}', text: 'Day: cure Poison, or heal 1 Blood.' },
  passage:     { name: 'Secret Passage', kind: 'defense', phase: 'night', target: false, count: 3, icon: '\u{1F6AA}', text: 'Night: the first attack on you goes to the heir on your left instead.' },
  lockeddoor:  { name: 'Locked Door',    kind: 'defense', phase: 'night', target: false, count: 2, icon: '\u{1F512}', text: 'Night: cancel every attack on you.' },

  // Schemes (20): played in the Day, in the open.
  blackmail:   { name: 'Blackmail',           kind: 'scheme', phase: 'day', target: true,  count: 4, icon: '✉', text: 'Take 3 Fortune from an heir. +1 Infamy, +1 Suspicion.' },
  frame:       { name: 'Frame',               kind: 'scheme', phase: 'day', target: true,  count: 3, icon: '\u{1F5BC}', text: 'Give another heir 2 Suspicion, and shed up to 2 of your own.' },
  forgery:     { name: 'Forged Will',         kind: 'scheme', phase: 'day', target: true,  count: 3, icon: '\u{1F58B}', text: 'Swap your cheapest bequest for a random one from another heir’s Estate.' },
  search:      { name: 'Search',              kind: 'scheme', phase: 'day', target: true,  count: 3, icon: '\u{1F50E}', text: 'Secretly see an heir’s hand, and the card they played into the Shadows last night.' },
  pickpocket:  { name: 'Pickpocket',          kind: 'scheme', phase: 'day', target: true,  count: 3, icon: '\u{1F90F}', text: 'Take a random card from an heir’s hand.' },
  powercut:    { name: 'Power Cut',           kind: 'scheme', phase: 'day', target: false, count: 2, icon: '\u{1F311}', text: 'Every living heir passes their whole hand to the left.' },
  fire:        { name: 'Fire in the Library', kind: 'scheme', phase: 'day', target: false, count: 2, icon: '\u{1F525}', text: 'Every living heir, you included, drops 2 random cards.' },

  // Inheritance (16): bequests played face down into your Estate.
  bequest1:    { name: 'Bequest',  kind: 'inheritance', phase: 'day', target: false, count: 4, value: 1, icon: '\u{1F4B0}', text: 'Worth 1 Fortune at the Reading.' },
  bequest2:    { name: 'Bequest',  kind: 'inheritance', phase: 'day', target: false, count: 4, value: 2, icon: '\u{1F4B0}', text: 'Worth 2 Fortune at the Reading.' },
  bequest3:    { name: 'Bequest',  kind: 'inheritance', phase: 'day', target: false, count: 4, value: 3, icon: '\u{1F4B0}', text: 'Worth 3 Fortune at the Reading.' },
  bequest4:    { name: 'Bequest',  kind: 'inheritance', phase: 'day', target: false, count: 4, value: 4, icon: '\u{1F4B0}', text: 'Worth 4 Fortune at the Reading.' },
};

const DECK_SIZE = Object.values(CARDS).reduce((n, c) => n + c.count, 0);

// Morning notices for a murder. Theatrical, never graphic.
const MURDER_NOTICES = [
  '{name} was found slumped over the billiards table. The {weapon} was still in the room.',
  "{name}'s chair at breakfast stayed empty. In the library, the {weapon} had been put back in the wrong place.",
  'The library clock stopped at 3:12 a.m. So, it seems, did {name}. Cause of death: the {weapon}.',
  '{name} went down to the cellar for a nightcap and never came back up. The {weapon} did come back up.',
  'The gardener found {name} among the roses at dawn. Nobody heard a thing. The {weapon} says otherwise.',
  'Someone drew the curtains in the smoking room. Behind them was {name}, and the {weapon}.',
];

const BOT_NAMES = [
  'Colonel Ashby', 'Lady Penrose', 'Dr. Vane', 'Miss Holloway', 'Reverend Pike',
  'Lord Marchbank', 'Mrs. Dunmore', 'Professor Quill', 'Captain Rook', 'Madame Sorel',
  'Sir Barnaby', 'Countess Wren', 'Judge Harrow', 'Major Finch', 'Duchess Lark',
];

function murderNotice(name, weapon, rng) {
  const t = MURDER_NOTICES[Math.floor(rng() * MURDER_NOTICES.length)];
  return t.replace('{name}', name).replace('{weapon}', weapon);
}

module.exports = { CARDS, DECK_SIZE, BOT_NAMES, murderNotice };
