'use strict';
// Checks the GitHub Actions workflows without a YAML library: triggers, permissions,
// job order, and that the Pages artifact contains exactly the files the browser needs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// Normalise line endings so the checks behave the same on Windows (CRLF) and Linux (LF).
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
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
  // Join YAML line continuations (a trailing backslash) and split into file names.
  const copied = copy[1].replace(/\\\n/g, ' ').split(/\s+/).filter((t) => t && t !== '\\');

  // Everything the service worker precaches must be published.
  const sw = read('sw.js');
  const shell = [...sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  for (const f of shell) {
    if (f === './') continue;
    const covered = copied.some((c) => f === c || f.startsWith(c + '/'));
    assert.ok(covered, `${f} is precached but not copied to the site`);
  }
  assert.ok(copied.includes('.nojekyll'), 'Pages config (.nojekyll) published');
  assert.ok(!copied.includes('CNAME'), 'the CNAME file is not in the repo; it is written from a variable');
  // The custom domain comes from a repository variable, so it is never hard-coded in git.
  assert.match(pages, /PAGES_DOMAIN: \$\{\{ vars\.PAGES_DOMAIN \}\}/);
  assert.match(pages, /echo "\$PAGES_DOMAIN" > _site\/CNAME/);

  // Only files that exist, and never tests, scripts, tmp or workflow files.
  for (const f of copied) assert.ok(exists(f), `copied file missing: ${f}`);
  for (const bad of ['test', 'scripts', 'tmp', '.github', 'package.json']) {
    assert.ok(!copied.includes(bad), `${bad} must not be published`);
  }
});

test('the Pages build writes config.js with the aircraft proxy from a repository variable', () => {
  const pages = read('.github/workflows/pages.yml');
  assert.match(pages, /AIRCRAFT_PROXY_URL: \$\{\{ vars\.AIRCRAFT_PROXY_URL \}\}/, 'reads the variable');
  const line = pages.split('\n').find((l) => l.includes('_site/config.js'));
  assert.ok(line, 'writes _site/config.js');
  assert.match(line, /window\.FARGEMS_CONFIG = \{ aircraftProxy: /, 'sets the global the app reads');
  assert.match(line, /\$AIRCRAFT_PROXY_URL/, 'uses the variable');
  assert.ok(!pages.includes('aircraftProxy":'), 'no proxy address hard-coded');
});

test('the repository default config.js carries no proxy address', () => {
  const cfg = read('config.js');
  assert.match(cfg, /aircraftProxy: ''/);
});
