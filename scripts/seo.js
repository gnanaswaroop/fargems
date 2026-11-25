'use strict';
// Build step for search engines. The repository never contains the site's address, so pages carry the
// placeholder __SITE_URL__ and this script fills it in from the PAGES_DOMAIN variable when the site is assembled.
//   node scripts/seo.js <site folder> [domain]
// With a domain: placeholders become https://<domain>, and sitemap.xml and robots.txt (with a Sitemap line) are written.
// Without one: every line holding a placeholder is dropped, and robots.txt just allows crawling.
const fs = require('node:fs');
const path = require('node:path');

const PLACEHOLDER = '__SITE_URL__';
const PAGES = ['index.html', 'about.html'];   // the pages worth finding; the app pages are marked noindex
const SITEMAP_PATHS = ['/', '/about.html'];

// A bare host name (optionally with a port). Anything else is treated as no domain.
function cleanDomain(raw) {
  const d = String(raw || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i.test(d) ? d.toLowerCase() : '';
}

function fillPlaceholders(html, domain) {
  if (domain) return html.split(PLACEHOLDER).join('https://' + domain);
  return html.split('\n').filter((line) => !line.includes(PLACEHOLDER)).join('\n');
}

function sitemapXml(domain) {
  const urls = SITEMAP_PATHS.map((p) => `  <url><loc>https://${domain}${p}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function robotsTxt(domain) {
  return 'User-agent: *\nAllow: /\n' + (domain ? `\nSitemap: https://${domain}/sitemap.xml\n` : '');
}

function applySeo(dir, rawDomain) {
  const domain = cleanDomain(rawDomain);
  for (const page of PAGES) {
    const file = path.join(dir, page);
    if (fs.existsSync(file)) fs.writeFileSync(file, fillPlaceholders(fs.readFileSync(file, 'utf8'), domain));
  }
  fs.writeFileSync(path.join(dir, 'robots.txt'), robotsTxt(domain));
  if (domain) fs.writeFileSync(path.join(dir, 'sitemap.xml'), sitemapXml(domain));
  return { domain };
}

module.exports = { PLACEHOLDER, PAGES, cleanDomain, fillPlaceholders, sitemapXml, robotsTxt, applySeo };

if (require.main === module) {
  const [dir, domain] = process.argv.slice(2);
  if (!dir) { console.error('usage: node scripts/seo.js <site folder> [domain]'); process.exit(1); }
  const r = applySeo(dir, domain);
  console.log(r.domain ? 'SEO files written for the custom domain' : 'SEO files written without a domain');
}
