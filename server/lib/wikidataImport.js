const { pool } = require('../db/schema');

const USER_AGENT = 'MurdrClubBot/1.0 (https://murdrclub.com; contact: thepef@gmail.com)';
const LIST_TITLE = 'List of unsolved murders (2000–present)';
const DEFAULT_LIMIT = 50;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DATE_RE = new RegExp(`\\b(\\d{1,2})\\s+(${MONTHS.join('|')})\\s+(\\d{4})\\b`);

// Wikidata's structured facts on individual "murder of X" items are too
// sparse to rely on (most lack a date/location property entirely) — dates
// and locations are parsed from the Wikipedia list article's own prose
// instead, which reliably has both. The app's region list doesn't cover the
// whole world (no Latin America, for instance), so a candidate with no
// keyword match is skipped rather than guessed at.
const REGION_KEYWORDS = {
  'us-ne': ['New York', 'New Jersey', 'Pennsylvania', 'Massachusetts', 'Connecticut', 'Maine', 'Vermont', 'New Hampshire', 'Rhode Island'],
  'us-se': ['Florida', 'Georgia,', 'Alabama', 'Mississippi', 'Tennessee', 'South Carolina', 'North Carolina', 'Virginia', 'Kentucky', 'Louisiana', 'Arkansas'],
  'us-mw': ['Ohio', 'Michigan', 'Illinois', 'Indiana', 'Wisconsin', 'Minnesota', 'Iowa', 'Missouri', 'Kansas', 'Nebraska'],
  'us-sw': ['Texas', 'Arizona', 'New Mexico', 'Oklahoma'],
  'us-w': ['California', 'Washington', 'Oregon', 'Nevada', 'Colorado', 'Utah', 'Idaho', 'Montana', 'Wyoming', 'Alaska', 'Hawaii', 'Pittsburgh'],
  uk: ['United Kingdom', 'England', 'Scotland', 'Wales', 'Northern Ireland', 'London', 'Belfast'],
  france: ['France', 'Paris', 'Calais'],
  iberia: ['Spain', 'Portugal', 'Madrid', 'Lisbon'],
  ireland: ['Republic of Ireland', 'Dublin'],
  dach: ['Germany', 'Austria', 'Switzerland', 'Berlin'],
  nordic: ['Norway', 'Sweden', 'Denmark', 'Finland', 'Iceland'],
  russia: ['Russia', 'Moscow', 'Saint Petersburg'],
  'eastern-europe': ['Poland', 'Ukraine', 'Romania', 'Hungary', 'Czech', 'Slovakia', 'Bulgaria', 'Serbia', 'Croatia', 'Moldova', 'Belarus', 'Transnistria', 'Kosovo', 'Bosnia', 'Albania', 'Montenegro', 'Slovenia', 'Macedonia', 'Luhansk', 'Kyiv', 'Tbilisi'],
  italy: ['Italy', 'Rome'],
  baltics: ['Estonia', 'Latvia', 'Lithuania'],
  africa: ['Nigeria', 'Kenya', 'South Africa', 'Egypt', 'Uganda', 'Ghana', 'Ethiopia', 'Morocco', 'Pretoria', 'Gauteng', 'Olivedale', 'Zimbabwe', 'Bulawayo', 'Central African Republic'],
  'middle-east': ['Israel', 'Palestine', 'Turkey', 'Iran', 'Iraq', 'Saudi Arabia', 'Lebanon', 'Syria', 'Jordan', 'Sinai'],
  india: ['India', 'Delhi', 'Mumbai'],
  asia: ['China', 'Japan', 'South Korea', 'Philippines', 'Thailand', 'Vietnam', 'Indonesia', 'Pakistan', 'Malaysia', 'Myanmar', 'Burma', 'Sagaing'],
  australia: ['Australia', 'New Zealand'],
};

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A bullet often links several things before the actual case-defining link
// (a place, an organization, a tangential concept). Prefer, in order: a link
// titled "Murder/Killing/Death of X" (the clearest signal), then a link
// immediately followed by an age in parentheses like "(42)" (how the list
// usually introduces a named victim), then just the first link.
function pickBestLink(line) {
  const links = [];
  const linkRe = /\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g;
  let m;
  while ((m = linkRe.exec(line))) {
    links.push({ title: m[1].trim(), display: (m[2] || m[1]).trim(), end: m.index + m[0].length });
  }
  if (links.length === 0) return null;
  const ofPattern = /^(Murders?|Killings?|Death) of\s+/i;
  const found = links.find(l => ofPattern.test(l.title));
  if (found) return found;
  const withAge = links.find(l => /^\s*\(\d{1,3}(–\d{1,3})?\)/.test(line.slice(l.end)));
  if (withAge) return withAge;
  return links[0];
}

// Even the best-picked link is sometimes a bare place name or a generic
// noun phrase rather than a victim/case name — Wikipedia's list doesn't
// always wikilink the actual victim. Filter those out rather than import a
// misleading title: a generic phrase almost always starts lowercase (link
// targets for people/incidents are proper nouns, capitalized), and a bare
// "City, State"-style place name has a short capitalized word right after
// a comma.
function looksLikeBadTitle(display) {
  if (/^[a-z]/.test(display)) return true;
  if (/^[A-Z][a-zA-Z\s]{2,20},\s*[A-Z]/.test(display)) return true;
  return false;
}

function matchRegion(text) {
  for (const [region, keywords] of Object.entries(REGION_KEYWORDS)) {
    for (const keyword of keywords) {
      if (new RegExp(`\\b${escapeRegExp(keyword)}`).test(text)) {
        return { region, keyword };
      }
    }
  }
  return null;
}

async function fetchWikitext() {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(LIST_TITLE)}&prop=wikitext&format=json&formatversion=2`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Wikipedia API request failed (${res.status})`);
  const data = await res.json();
  if (!data.parse) throw new Error('Could not load the Wikipedia unsolved-murders list');
  return data.parse.wikitext;
}

// Parses the decade-sectioned bullet list into candidates with a title
// (Wikipedia article), a display name, the cleaned prose text, and a date.
// Candidates without a parseable "D Month YYYY" date, or whose best link
// looks like a generic phrase/place name rather than a case name, are
// dropped — there are enough dated entries in the list that skipping the
// unclear ones still leaves plenty to import.
function extractCandidates(wikitext) {
  const cleaned = wikitext
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '');

  const parts = cleaned.split(/^==\s*([^=]+?)\s*==\s*$/m);
  const candidates = [];
  for (let i = 1; i < parts.length; i += 2) {
    const sectionName = parts[i].trim();
    if (!/^\d{4}s$/.test(sectionName)) continue;
    const body = parts[i + 1];
    const lines = body.split('\n').filter(l => l.startsWith('*') && !l.startsWith('**'));
    for (const line of lines) {
      const best = pickBestLink(line);
      if (!best) continue;
      if (looksLikeBadTitle(best.display)) continue;
      const plain = line
        .replace(/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g, (_, t, d) => d || t)
        .replace(/\{\{[^}]*\}\}/g, '')
        .replace(/^\*\s*/, '')
        .trim();
      const dateMatch = plain.match(DATE_RE);
      if (!dateMatch) continue;
      const date = new Date(`${dateMatch[1]} ${dateMatch[2]} ${dateMatch[3]}`);
      if (Number.isNaN(date.getTime())) continue;
      candidates.push({ title: best.title, display: best.display, text: plain, date });
    }
  }
  return candidates;
}

function deriveVictimName(display, title) {
  const strip = name => name.replace(/^(Murders?|Killings?|Death) of\s+/i, '').trim();
  return strip(display) || strip(title);
}

async function getClubUserId() {
  const { rows } = await pool.query('SELECT id FROM users WHERE is_club = true LIMIT 1');
  if (!rows[0]) throw new Error('Club system user not seeded');
  return rows[0].id;
}

// Imports up to `limit` of the most recent cases from Wikipedia's curated
// "List of unsolved murders" article that map to one of the app's existing
// regions, skipping duplicates (tracked via cases.wikipedia_title) and
// anything with no parseable date or no recognizable region rather than
// guessing. Cases land as 'pending' — same review gate as any other new
// case suggestion — with a sourced contribution linking back to Wikipedia.
async function importFromWikipedia(limit = DEFAULT_LIMIT) {
  const cappedLimit = Math.max(1, Math.min(limit, DEFAULT_LIMIT));
  const wikitext = await fetchWikitext();
  const candidates = extractCandidates(wikitext).sort((a, b) => b.date - a.date);

  const { rows: existingRows } = await pool.query(
    `SELECT wikipedia_title FROM cases WHERE wikipedia_title IS NOT NULL`
  );
  const alreadyImported = new Set(existingRows.map(r => r.wikipedia_title));

  const clubUserId = await getClubUserId();
  const imported = [];
  let skippedNoRegion = 0;
  let duplicates = 0;

  for (const c of candidates) {
    if (imported.length >= cappedLimit) break;
    if (alreadyImported.has(c.title)) {
      duplicates += 1;
      continue;
    }
    const match = matchRegion(c.text);
    if (!match) {
      skippedNoRegion += 1;
      continue;
    }

    const victimName = deriveVictimName(c.display, c.title);
    // The list's own prose is used as the summary rather than fetching the
    // linked Wikipedia article's lead extract — for well-known victims that
    // extract is often a general biography and doesn't mention the murder
    // at all, while the list text always describes the case specifically.
    const summary = c.text;
    const dateOccurred = c.date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const articleUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(c.title.replace(/ /g, '_'))}`;

    const { rows: inserted } = await pool.query(
      `INSERT INTO cases (title, victim_name, region_key, location, date_occurred, summary, submitted_by, status, wikipedia_title)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8) RETURNING id`,
      [c.display, victimName, match.region, match.keyword, dateOccurred, summary, clubUserId, c.title]
    );
    const caseId = inserted[0].id;

    await pool.query(
      'INSERT INTO case_members (case_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [caseId, clubUserId]
    );
    await pool.query(
      `INSERT INTO contributions (case_id, user_id, body, link_url, status)
       VALUES ($1, $2, $3, $4, 'visible')`,
      [caseId, clubUserId, `Source: Wikipedia, "${c.title}."`, articleUrl]
    );

    imported.push({ id: caseId, title: c.display, region: match.region, dateOccurred });
    alreadyImported.add(c.title);
  }

  return { imported, duplicates, skippedNoRegion, scanned: candidates.length };
}

module.exports = { importFromWikipedia };
