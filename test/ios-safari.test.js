'use strict';
// The iPhone Safari test needs a browser, so it runs in its own workflow. These keep it wired up and out of npm test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('the iOS test runs in its own workflow on every pull request, with a pinned test browser package', () => {
  const wf = read('.github/workflows/ios-safari.yml');
  assert.match(wf, /pull_request:/);
  assert.match(wf, /npx playwright install --with-deps \$\{\{ matrix\.browser \}\}/);
  assert.match(wf, /browser: webkit, file: e2e\/ios\/safari\.e2e\.js/, 'the Safari tests run in the WebKit jobs');
  assert.match(wf, /npm ci/);
  assert.match(wf, /node --test --test-reporter=spec \$\{\{ matrix\.file \}\}/);
  assert.match(wf, /permissions:\s*\n\s*contents: read/);
  const pkg = JSON.parse(read('e2e/ios/package.json'));
  assert.match(pkg.devDependencies.playwright, /^\d+\.\d+\.\d+$/, 'an exact version, so the test browser does not change by itself');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'e2e/ios/package-lock.json')), 'a lock file, for npm ci');
});

test('the app itself stays free of packages: the test browser lives in e2e/ios only', () => {
  const root = JSON.parse(read('package.json'));
  assert.equal(root.dependencies, undefined);
  assert.equal(root.devDependencies, undefined);
  assert.equal(root.scripts['test:ios'], 'node --test e2e/ios/safari.e2e.js');
  assert.equal(root.scripts.test, 'node --test', 'the normal run does not start a browser');
  assert.match(read('.gitignore'), /node_modules\//);
});

test('the iOS test covers the iPhone-only paths and says honestly what it cannot cover', () => {
  const src = read('e2e/ios/safari.e2e.js');
  for (const needle of ['requestPermission', 'webkitCompassHeading', 'iPhone 14', 'Add to Home Screen', 'viewport-fit=cover', 'fg.compass', '#arBtn', 'scrollWidth', 'HITEC']) {
    assert.ok(src.includes(needle), `mentions ${needle}`);
  }
  assert.match(src, /not a real iPhone/);
  assert.match(src, /It does not replace trying the app on a real iPhone/);
  assert.match(src, /order\.slice\(0, 2\), \['motion', 'location'\]/, 'the motion prompt must come first, inside the tap');
});
