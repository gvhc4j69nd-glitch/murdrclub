const { pool } = require('../db/schema');
const { getAnthropicClient } = require('./anthropicClient');

// Synthesizes a short "state of the case" write-up from the evidence already
// submitted — no web search, this reasons over existing inputs only. Goes
// live immediately (auto-approved) rather than waiting on admin review —
// unlike a new case suggestion, this only restates evidence already visible
// on the case page. Admins can still pull it down after the fact if it's bad.
async function runAnalysisForCase(caseId) {
  const anthropicClient = getAnthropicClient();
  if (!anthropicClient) {
    console.log('Analysis skipped: ANTHROPIC_API_KEY not set');
    return;
  }

  try {
    const { rows: caseRows } = await pool.query(
      `SELECT id, title, victim_name, location, date_occurred, summary, solved_at, ai_analysis_updated_at
       FROM cases WHERE id = $1 AND status = 'approved'`,
      [caseId]
    );
    const caseRow = caseRows[0];
    if (!caseRow || caseRow.solved_at) return;

    const { rows: contributions } = await pool.query(
      `SELECT ct.body, ct.link_url, ct.created_at, u.username, u.is_club
       FROM contributions ct JOIN users u ON u.id = ct.user_id
       WHERE ct.case_id = $1 AND ct.status = 'visible'
       ORDER BY ct.created_at ASC`,
      [caseId]
    );

    const lastInputAt = contributions.length > 0 ? contributions[contributions.length - 1].created_at : null;
    const hasNewInputs =
      !caseRow.ai_analysis_updated_at || (lastInputAt && new Date(lastInputAt) > new Date(caseRow.ai_analysis_updated_at));

    if (!hasNewInputs) {
      console.log(`Analysis skipped for case ${caseId}: no new inputs since last analysis`);
      return;
    }

    const evidenceText =
      contributions.length > 0
        ? contributions
            .map((c, i) => `${i + 1}. [${c.username}${c.is_club ? ' — club research' : ''}] ${c.body}${c.link_url ? ` (source: ${c.link_url})` : ''}`)
            .join('\n')
        : '(No community evidence submitted yet — base your analysis on the case summary only.)';

    const prompt = `You are summarizing the state of an unsolved murder case for a citizen-investigation site, based only on what's been submitted so far.

Case: "${caseRow.title}"
Victim: ${caseRow.victim_name || 'unknown'}
Location: ${caseRow.location || 'unknown'}
Date: ${caseRow.date_occurred || 'unknown'}
Summary: ${caseRow.summary}

Evidence and leads submitted by members and club research, oldest to newest:
${evidenceText}

Write a short (150-250 word) analysis of where this case stands. Focus on: the most credible leads or patterns across the submitted evidence, contradictions or open questions worth investigating, and what kind of evidence would help most next. Do NOT accuse or name any specific living person as the perpetrator — discuss theories and evidence, not verdicts. If the submitted evidence is too thin to say anything meaningful, say so plainly instead of speculating.`;

    const message = await anthropicClient.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });
    const analysis = message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n')
      .trim();

    await pool.query(
      `UPDATE cases SET ai_analysis = $2, ai_analysis_status = 'approved', ai_analysis_updated_at = NOW() WHERE id = $1`,
      [caseId, analysis]
    );
    console.log(`Analysis generated for case ${caseId}, published`);
  } catch (err) {
    console.error(`Analysis failed for case ${caseId}:`, err.message);
  }
}

async function runWeeklyAnalysis() {
  if (!getAnthropicClient()) {
    console.log('Weekly analysis skipped: ANTHROPIC_API_KEY not set');
    return;
  }
  const { rows } = await pool.query(`SELECT id FROM cases WHERE status = 'approved' AND solved_at IS NULL`);
  for (const { id } of rows) {
    await runAnalysisForCase(id);
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

module.exports = { runAnalysisForCase, runWeeklyAnalysis };
