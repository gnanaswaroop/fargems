#!/usr/bin/env node
'use strict';
/* Gives every script and stylesheet a ?v=<build> address in the published pages.
 *
 * A CDN may keep a file such as config.js or app.js for hours, and the browser asks it again under the same address.
 * Then a reload keeps loading the old copy while version.json (asked for with a changing query) already names the new
 * build, and the "new version available" bar never goes away. With the build in the address, a new deploy means new
 * addresses, so nothing old can answer. The pages themselves are never cached by the CDN.
 *
 *   node scripts/stamp.js <site dir> <build id>
 */
const fs = require('node:fs');
const path = require('node:path');

// Adds ?v=<build> to the local .js and .css files a page loads. Addresses with a scheme (CDN libraries) are left alone.
function stampHtml(html, build) {
  const v = encodeURIComponent(build);
  return html.replace(/\b(src|href)="((?![a-z][a-z0-9+.-]*:|\/\/)[^"?#]+\.(?:js|css))"/gi, (m, attr, url) => `${attr}="${url}?v=${v}"`);
}

function stampSite(dir, build) {
  if (!build) return [];
  const done = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.html')) continue;
    const p = path.join(dir, f), html = fs.readFileSync(p, 'utf8'), out = stampHtml(html, build);
    if (out !== html) { fs.writeFileSync(p, out); done.push(f); }
  }
  return done;
}

if (require.main === module) {
  const [dir, build] = process.argv.slice(2);
  if (!dir) { console.error('usage: node scripts/stamp.js <site dir> <build id>'); process.exit(2); }
  console.log('stamped:', stampSite(dir, build || '').join(', ') || 'nothing');
}

module.exports = { stampHtml, stampSite };
