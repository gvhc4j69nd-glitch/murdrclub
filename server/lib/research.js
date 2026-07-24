const Anthropic = require('@anthropic-ai/sdk');
const { pool } = require('../db/schema');

let anthropic = null;
function client() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!anthropic) anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropic;
}

let clubUserId = null;
async function getClubUserId() {
  if (clubUserId) return clubUserId;
  const { rows } = await pool.query('SELECT id FROM users WHERE is_club = true LIMIT 1');
  if (!rows[0]) throw new Error('Club system user not seeded');
  clubUserId = rows[0].id;
  return clubUserId;
}

function extractSources(text) {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Cases that keep coming up empty get researched less often. Streak resets
// to 0 the moment a run finds something new.
function daysBetweenRuns(missStreak) {
  if (missStreak >= 4) return 28;
  if (missStreak >= 2) return 14;
  return 7;
}

// Searches the web for material on a case and files anything new as pending
// club contributions for a regional/super admin to review. Never throws —
// callers (case approval, the weekly cron) must not go down with it.
async function runResearchForCase(caseId) {
  const anthropicClient = client();
  if (!anthropicClient) {
    console.log('Research skipped: ANTHROPIC_API_KEY not set');
    return;
  }

  try {
    const { rows: caseRows } = await pool.query(
      `SELECT id, title, victim_name, location, date_occurred, summary, solved_at, research_miss_streak
       FROM cases WHERE id = $1 AND status = 'approved'`,
      [caseId]
    );
    const caseRow = caseRows[0];
    if (!caseRow || caseRow.solved_at) return;

    const { rows: existing } = await pool.query(
      "SELECT link_url FROM contributions WHERE case_id = $1 AND link_url != ''",
      [caseId]
    );
    const knownUrls = new Set(existing.map(r => r.link_url));

    const prompt = `You are researching an unsolved murder case for a citizen-investigation site.
Case: "${caseRow.title}"
Victim: ${caseRow.victim_name || 'unknown'}
Location: ${caseRow.location || 'unknown'}
Date: ${caseRow.date_occurred || 'unknown'}
Summary: ${caseRow.summary}

Search the web for credible news articles, case files, or reporting about this case. Skip these URLs, already known: ${[...knownUrls].join(', ') || '(none yet)'}.

Respond with ONLY a JSON array (no prose, no markdown fences) of up to 5 newly found sources, each shaped as:
{"url": "...", "title": "...", "summary": "1-3 sentence summary of what this source adds"}

If you find nothing new and credible, respond with an empty array: []`;

    const message = await anthropicClient.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 2048,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
      messages: [{ role: 'user', content: prompt }],
    });

    const text = message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');
    const sources = extractSources(text);

    const clubId = await getClubUserId();
    let added = 0;
    for (const source of sources) {
      if (!source?.url || knownUrls.has(source.url)) continue;
      knownUrls.add(source.url);
      await pool.query(
        `INSERT INTO contributions (case_id, user_id, body, link_url, status)
         VALUES ($1, $2, $3, $4, 'pending')`,
        [caseId, clubId, source.summary || source.title || '', source.url]
      );
      added += 1;
    }

    const newStreak = added > 0 ? 0 : caseRow.research_miss_streak + 1;
    await pool.query(
      'UPDATE cases SET last_researched_at = NOW(), research_miss_streak = $2 WHERE id = $1',
      [caseId, newStreak]
    );
    console.log(`Research for case ${caseId}: added ${added} pending contribution(s), miss streak now ${newStreak}`);
  } catch (err) {
    console.error(`Research failed for case ${caseId}:`, err.message);
  }
}

async function runWeeklyResearch() {
  if (!client()) {
    console.log('Weekly research skipped: ANTHROPIC_API_KEY not set');
    return;
  }
  const { rows } = await pool.query(
    `SELECT id, last_researched_at, research_miss_streak FROM cases WHERE status = 'approved' AND solved_at IS NULL`
  );
  const now = Date.now();
  let skipped = 0;
  for (const c of rows) {
    if (c.last_researched_at) {
      const dueAt = new Date(c.last_researched_at).getTime() + daysBetweenRuns(c.research_miss_streak) * 24 * 60 * 60 * 1000;
      if (dueAt > now) {
        skipped += 1;
        continue;
      }
    }
    await runResearchForCase(c.id);
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  console.log(`Weekly research: ran ${rows.length - skipped} case(s), skipped ${skipped} still in backoff`);
}

module.exports = { runResearchForCase, runWeeklyResearch };
