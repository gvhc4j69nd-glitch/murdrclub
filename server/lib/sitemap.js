const { pool } = require('../db/schema');
const { REGIONS } = require('../db/regions');

function escapeXml(str) {
  return String(str).replace(/&/g, '&amp;');
}

function url(loc, changefreq, priority) {
  return `  <url>\n    <loc>${escapeXml(loc)}</loc>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
}

// Lists every publicly indexable page: static top-level pages, one per
// region, and one per approved case. Excludes auth-gated/private pages
// (login, messages, admin), which are already blocked in robots.txt.
async function renderSitemap(origin) {
  const entries = [
    url(`${origin}/`, 'daily', '1.0'),
    url(`${origin}/regions`, 'weekly', '0.8'),
    url(`${origin}/cases`, 'daily', '0.9'),
    url(`${origin}/members`, 'weekly', '0.5'),
  ];

  for (const region of REGIONS) {
    entries.push(url(`${origin}/regions/${region.key}`, 'weekly', '0.7'));
  }

  const { rows } = await pool.query(`SELECT id FROM cases WHERE status = 'approved' ORDER BY id ASC`);
  for (const { id } of rows) {
    entries.push(url(`${origin}/cases/${id}`, 'weekly', '0.8'));
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`;
}

module.exports = { renderSitemap };
