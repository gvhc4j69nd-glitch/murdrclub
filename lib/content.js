'use strict';

/**
 * Words the Proprietor uses: the daily Errand questions, the morning murder
 * notices, and names for practice bots. Kept apart from the rules so the
 * flavour can change without touching the game engine.
 */

// One Errand per day. Forty is more than a full season needs.
// `a` is the index of the correct choice.
const ERRANDS = [
  { q: 'Who wrote "Murder on the Orient Express"?', c: ['Dorothy L. Sayers', 'Agatha Christie', 'Arthur Conan Doyle', 'Raymond Chandler'], a: 1 },
  { q: 'Which detective lived at 221B Baker Street?', c: ['Hercule Poirot', 'Philip Marlowe', 'Sherlock Holmes', 'Miss Marple'], a: 2 },
  { q: 'In classic mysteries, which poison smells of bitter almonds?', c: ['Arsenic', 'Cyanide', 'Hemlock', 'Strychnine'], a: 1 },
  { q: 'In chess, which is the only piece that can jump over others?', c: ['Bishop', 'Rook', 'Queen', 'Knight'], a: 3 },
  { q: 'Which planet is known as the Red Planet?', c: ['Venus', 'Mars', 'Jupiter', 'Mercury'], a: 1 },
  { q: 'How many sides does a hexagon have?', c: ['5', '6', '7', '8'], a: 1 },
  { q: 'What is the largest ocean on Earth?', c: ['Atlantic', 'Indian', 'Arctic', 'Pacific'], a: 3 },
  { q: 'What is the chemical symbol for gold?', c: ['Ag', 'Au', 'Gd', 'Go'], a: 1 },
  { q: 'Who wrote "Romeo and Juliet"?', c: ['Charles Dickens', 'Jane Austen', 'William Shakespeare', 'Geoffrey Chaucer'], a: 2 },
  { q: 'At sea level, water boils at how many degrees Celsius?', c: ['90', '100', '110', '212'], a: 1 },
  { q: 'How many minutes are there in a day?', c: ['1,200', '1,440', '1,600', '1,080'], a: 1 },
  { q: 'What is the hardest natural substance?', c: ['Quartz', 'Granite', 'Diamond', 'Titanium'], a: 2 },
  { q: 'What is the smallest prime number?', c: ['0', '1', '2', '3'], a: 2 },
  { q: 'In which city is the Colosseum?', c: ['Athens', 'Rome', 'Istanbul', 'Naples'], a: 1 },
  { q: 'How many players does a soccer team have on the field?', c: ['9', '10', '11', '12'], a: 2 },
  { q: 'Which gas do plants absorb from the air?', c: ['Oxygen', 'Nitrogen', 'Carbon dioxide', 'Helium'], a: 2 },
  { q: 'What is the square root of 144?', c: ['11', '12', '13', '14'], a: 1 },
  { q: 'Which instrument usually has 88 keys?', c: ['Piano', 'Organ', 'Accordion', 'Harpsichord'], a: 0 },
  { q: 'What is the tallest mountain above sea level?', c: ['K2', 'Kilimanjaro', 'Everest', 'Denali'], a: 2 },
  { q: 'What is the capital of Canada?', c: ['Toronto', 'Vancouver', 'Ottawa', 'Montreal'], a: 2 },
  { q: 'How many continents are there?', c: ['5', '6', '7', '8'], a: 2 },
  { q: 'Who painted the Mona Lisa?', c: ['Michelangelo', 'Leonardo da Vinci', 'Raphael', 'Botticelli'], a: 1 },
  { q: 'What is the fastest land animal?', c: ['Lion', 'Pronghorn', 'Greyhound', 'Cheetah'], a: 3 },
  { q: 'Which metal is liquid at room temperature?', c: ['Mercury', 'Lead', 'Tin', 'Zinc'], a: 0 },
  { q: 'In what year did humans first land on the Moon?', c: ['1965', '1969', '1972', '1959'], a: 1 },
  { q: 'What is the longest river in South America?', c: ['Orinoco', 'Paraná', 'Amazon', 'Magdalena'], a: 2 },
  { q: 'How many bones are in the adult human body?', c: ['186', '206', '226', '256'], a: 1 },
  { q: 'In chess, which piece only ever moves diagonally?', c: ['Bishop', 'Knight', 'Rook', 'King'], a: 0 },
  { q: 'What is the largest planet in the solar system?', c: ['Saturn', 'Neptune', 'Jupiter', 'Uranus'], a: 2 },
  { q: 'Which red-cell blood type is the universal donor?', c: ['A positive', 'AB negative', 'O positive', 'O negative'], a: 3 },
  { q: 'What is the currency of Japan?', c: ['Won', 'Yuan', 'Yen', 'Baht'], a: 2 },
  { q: 'How many hearts does an octopus have?', c: ['1', '2', '3', '4'], a: 2 },
  { q: 'What is the main ingredient in guacamole?', c: ['Avocado', 'Lime', 'Tomato', 'Pea'], a: 0 },
  { q: 'Which famous liner sank in 1912?', c: ['Lusitania', 'Titanic', 'Britannic', 'Queen Mary'], a: 1 },
  { q: 'How many strings does a standard guitar have?', c: ['4', '5', '6', '7'], a: 2 },
  { q: 'How many days are in a leap year?', c: ['364', '365', '366', '367'], a: 2 },
  { q: 'What is the capital of Australia?', c: ['Sydney', 'Melbourne', 'Canberra', 'Perth'], a: 2 },
  { q: 'Which is the closest planet to the Sun?', c: ['Venus', 'Mercury', 'Mars', 'Earth'], a: 1 },
  { q: 'How many sides does a stop sign have?', c: ['6', '7', '8', '10'], a: 2 },
  { q: 'Which language has the most native speakers?', c: ['English', 'Spanish', 'Mandarin Chinese', 'Hindi'], a: 2 },
];

// Morning notices. Theatrical, never graphic.
const MURDER_NOTICES = [
  '{name} was found slumped over the billiards table, a cold cup of tea at their elbow.',
  "{name}'s chair at breakfast stayed empty. Their room key turned up in the koi pond.",
  'The library clock stopped at 3:12 a.m. So, it seems, did {name}.',
  '{name} went to fetch a nightcap from the cellar and never came back up the stairs.',
  'A single black glove was left on the piano. {name} will not be playing again.',
  "The gardener found {name} among the roses at dawn. Nobody heard a thing.",
  "{name}'s membership card was found torn in two on the grand staircase.",
  'Someone drew the curtains in the smoking room. Behind them was {name}.',
  'The candles in the conservatory had burned down to nothing, and so had {name}’s luck.',
  "{name} left the Lounge early, complaining of a draught. The draught won.",
  'A telegram arrived for {name} this morning. There was no one left to sign for it.',
  'The house cat refuses to leave the study. {name} is in there, and will not be coming out.',
];

const QUIET_NIGHT = [
  'The night passed without a sound. Every chair is filled at breakfast — for now.',
  'No body this morning. The Murderers, it seems, could not agree.',
];

const BOT_NAMES = [
  'Colonel Ashby', 'Lady Penrose', 'Dr. Vane', 'Miss Holloway', 'Reverend Pike',
  'Lord Marchbank', 'Mrs. Dunmore', 'Professor Quill', 'Captain Rook', 'Madame Sorel',
  'Sir Barnaby', 'Nurse Ingram', 'Mr. Tolliver', 'Countess Wren', 'Judge Harrow',
  'Ms. Calloway', 'Major Finch', 'Duchess Lark', 'Father Grimsby', 'Signor Valli',
  'Dame Ottoline', 'Mr. Blackwood', 'Lady Ferrers', 'Inspector Gale', 'Baron Crane',
];

function pick(list, rng) {
  return list[Math.floor(rng() * list.length)];
}

function murderNotice(name, rng) {
  return pick(MURDER_NOTICES, rng).replace('{name}', name);
}

function quietNight(rng) {
  return pick(QUIET_NIGHT, rng);
}

module.exports = { ERRANDS, BOT_NAMES, murderNotice, quietNight };
