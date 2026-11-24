'use strict';
// Checks the GitHub Actions workflows without a YAML library: triggers, permissions,
// job order, and that the Pages artifact contains exactly the files the browser needs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(ROOT, f));

test('CI runs npm test on pull requests and pushes to main', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /pull_request:/);
  assert.match(ci, /branches: \[main\]/);
  assert.match(ci, /run: npm test/);
  assert.match(ci, /permissions:\n  contents: read/);
});

test('Pages deploy runs only on main (or manually), with read-only defaults', () => {
  const pages = read('.github/workflows/pages.yml');
  assert.match(pages, /push:\n    branches: \[main\]/);
  assert.match(pages, /workflow_dispatch:/);
  assert.match(pages, /contents: read\n  pages: write\n  id-token: write/);
});

test('Pages deploy waits for tests, then build, then deploy', () => {
  const pages = read('.github/workflows/pages.yml');
  assert.match(pages, /build:\n    needs: test/);
  assert.match(pages, /deploy:\n    needs: build/);
  assert.match(pages, /run: npm test/);
  assert.match(pages, /actions\/upload-pages-artifact@v3/);
  assert.match(pages, /actions\/deploy-pages@v4/);
  assert.match(pages, /url: \$\{\{ steps\.deployment\.outputs\.page_url \}\}/);
});

test('Pages artifact copies every file the pages precache, and no private folders', () => {
  const pages = read('.github/workflows/pages.yml');
  const copy = pages.match(/cp -r ([\s\S]*?) _site\//);
  assert.ok(copy, 'copy command found');
  const copied = copy[1].replace(/\\n/g, ' ').trim().split(/\s+/);

  // Everything the service worker precaches must be published.
  const sw = read('sw.js');
  const shell = [...sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  for (const f of shell) {
    if (f === './') continue;
    const covered = copied.some((c) => f === c || f.startsWith(c + '/'));
    assert.ok(covered, `${f} is precached but not copied to the site`);
  }
  assert.ok(copied.includes('CNAME') && copied.includes('.nojekyll'), 'custom domain and Pages config published');

  // Only files that exist, and never tests, scripts, tmp or workflow files.
  for (const f of copied) assert.ok(exists(f), `copied file missing: ${f}`);
  for (const bad of ['test', 'scripts', 'tmp', '.github', 'package.json']) {
    assert.ok(!copied.includes(bad), `${bad} must not be published`);
  }
});
