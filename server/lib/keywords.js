const { pool } = require('../db/schema');
const { getAnthropicClient } = require('./anthropicClient');

// Generates a short list of search keywords for a case — alternate names,
// nearby places, associated people, and thematic terms — so the site search
// can find a case by things visitors might type that don't appear verbatim
// in the title or summary. Runs once per case (skips if keywords already
// set) rather than on a schedule, since a case's core facts rarely change
// after it's approved.
async function generateKeywordsForCase(caseId) {
  const anthropicClient = getAnthropicClient();
  if (!anthropicClient) {
    console.log('Keyword generation skipped: ANTHROPIC_API_KEY not set');
    return;
  }

  try {
    const { rows } = await pool.query(
      `SELECT title, victim_name, location, date_occurred, summary, keywords
       FROM cases WHERE id = $1 AND status = 'approved'`,
      [caseId]
    );
    const caseRow = rows[0];
    if (!caseRow || caseRow.keywords) return;

    const prompt = `You are generating search keywords for an unsolved murder case on a citizen-investigation site, so visitors can find it by searching for things that might not appear verbatim in the title or summary.

Case: "${caseRow.title}"
Victim: ${caseRow.victim_name || 'unknown'}
Location: ${caseRow.location || 'unknown'}
Date: ${caseRow.date_occurred || 'unknown'}
Summary: ${caseRow.summary}

Respond with ONLY a comma-separated list of 8-15 short keywords/phrases (no prose, no numbering). Include: alternate spellings or nicknames of the victim's name, nearby cities/regions/landmarks, other named people mentioned (suspects, family, witnesses), and thematic terms that describe the case (e.g. "cold case", "serial killer", "poisoning", "unsolved disappearance", "journalist killed").`;

    const message = await anthropicClient.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
      .trim();
    const keywords = text
      .split(',')
      .map(k => k.trim())
      .filter(Boolean)
      .join(', ');
    if (!keywords) return;

    await pool.query('UPDATE cases SET keywords = $2 WHERE id = $1', [caseId, keywords]);
    console.log(`Keywords generated for case ${caseId}`);
  } catch (err) {
    console.error(`Keyword generation failed for case ${caseId}:`, err.message);
  }
}

module.exports = { generateKeywordsForCase };
