'use strict';
// Structural checks on the static site: every local file the pages reference must exist,
// the manifest must be valid, and the service worker must precache real files.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(ROOT, f));

test('index.html references only local files that exist (or external https URLs)', () => {
  const html = read('index.html');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length > 0);
  for (const r of refs) {
    if (/^https:\/\//.test(r)) continue;
    assert.ok(exists(r.split('?')[0]), `missing file referenced: ${r}`);
  }
});

test('index.html loads lib/core.js before app.js', () => {
  const html = read('index.html');
  const core = html.indexOf('lib/core.js');
  const app = html.indexOf('app.js');
  assert.ok(core > -1 && app > -1, 'both scripts present');
  assert.ok(core < app, 'core must load first so window.FarGems exists');
});

test('index.html pins CDN libraries to exact versions', () => {
  const html = read('index.html');
  assert.match(html, /satellite\.js@5\.0\.0\//);
  assert.match(html, /astronomy-engine@2\.1\.19\//);
});

test('index.html has the expected filter tabs matching app.js', () => {
  const html = read('index.html');
  const app = read('app.js');
  for (const tab of ['aircraft', 'satellites', 'bodies', 'stars', 'showers']) {
    assert.ok(html.includes(`data-tab="${tab}"`), `button for ${tab}`);
    assert.ok(app.includes(`case '${tab}':`), `render case for ${tab}`);
  }
});

test('manifest.webmanifest is valid JSON with installable fields and existing icons', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.display, 'standalone');
  assert.ok(m.name && m.short_name && m.start_url);
  assert.ok(m.icons.length >= 2);
  for (const icon of m.icons) {
    assert.ok(exists(icon.src), `icon ${icon.src}`);
  }
  const sizes = m.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
});

test('PNG icons have the PNG signature and expected dimensions', () => {
  for (const [file, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
    const buf = fs.readFileSync(path.join(ROOT, file));
    assert.deepEqual([...buf.subarray(1, 4)], [0x50, 0x4e, 0x47], `${file} PNG magic`);
    assert.equal(buf.readUInt32BE(16), size, `${file} width`);
    assert.equal(buf.readUInt32BE(20), size, `${file} height`);
  }
});

test('service worker precaches only files that exist', () => {
  const sw = read('sw.js');
  const m = sw.match(/const SHELL = \[([^\]]*)\]/);
  assert.ok(m, 'SHELL list found');
  const files = [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]).filter((f) => f && f !== './');
  assert.ok(files.length > 0);
  for (const f of files) assert.ok(exists(f), `precache missing: ${f}`);
});

test('CNAME and .nojekyll exist for GitHub Pages', () => {
  assert.equal(read('CNAME').trim(), 'fargems.com');
  assert.ok(exists('.nojekyll'));
});

test('app.js parses as JavaScript', () => {
  // Syntax-only check; the browser run is covered by manual testing.
  const { execFileSync } = require('node:child_process');
  execFileSync(process.execPath, ['--check', path.join(ROOT, 'app.js')]);
});
