const fs = require('fs');
const path = require('path');

let cachedTemplate = null;
function readIndexHtml(clientDist) {
  if (!cachedTemplate) cachedTemplate = fs.readFileSync(path.join(clientDist, 'index.html'), 'utf8');
  return cachedTemplate;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function summarize(text, maxLen = 200) {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > maxLen ? `${clean.slice(0, maxLen - 1).trim()}…` : clean;
}

// Injects case-specific title/description/Open Graph/Twitter Card tags into
// the built index.html so search engines and link-preview bots — which
// mostly don't execute JS — see real per-case metadata instead of the
// generic site-wide tags.
function renderCaseHtml(clientDist, caseRow, canonicalUrl) {
  const title = `${caseRow.title}${caseRow.victim_name ? ` — ${caseRow.victim_name}` : ''} | MURD'R CLUB`;
  const description = summarize(caseRow.summary);
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  const u = escapeHtml(canonicalUrl);

  const meta = `
    <title>${t}</title>
    <meta name="description" content="${d}" />
    <link rel="canonical" href="${u}" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="MURD'R CLUB" />
    <meta property="og:title" content="${t}" />
    <meta property="og:description" content="${d}" />
    <meta property="og:url" content="${u}" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${t}" />
    <meta name="twitter:description" content="${d}" />
  `;

  return readIndexHtml(clientDist)
    .replace(/<title>.*?<\/title>\s*/i, '')
    .replace(/<meta name="description"[^>]*>\s*/i, '')
    .replace('</head>', `${meta}\n  </head>`);
}

module.exports = { renderCaseHtml };
