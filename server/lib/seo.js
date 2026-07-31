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
  const imageUrl = `${new URL(canonicalUrl).origin}/og-image.png`;
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  const u = escapeHtml(canonicalUrl);
  const img = escapeHtml(imageUrl);

  const meta = `
    <title>${t}</title>
    <meta name="description" content="${d}" />
    <meta name="robots" content="index, follow" />
    <link rel="canonical" href="${u}" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="MURD'R CLUB" />
    <meta property="og:title" content="${t}" />
    <meta property="og:description" content="${d}" />
    <meta property="og:url" content="${u}" />
    <meta property="og:image" content="${img}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${t}" />
    <meta name="twitter:description" content="${d}" />
    <meta name="twitter:image" content="${img}" />
  `;

  return readIndexHtml(clientDist)
    .replace(/<title>.*?<\/title>\s*/i, '')
    .replace(/<meta name="description"[^>]*>\s*/i, '')
    .replace(/<meta name="robots"[^>]*>\s*/i, '')
    .replace(/<link rel="canonical"[^>]*>\s*/i, '')
    .replace(/<meta property="og:[^>]*>\s*/gi, '')
    .replace(/<meta name="twitter:[^>]*>\s*/gi, '')
    .replace('</head>', `${meta}\n  </head>`);
}

module.exports = { renderCaseHtml };
