'use strict';
// The live-data check talks to real feeds, so it is opt-in and runs on a schedule. These keep it wired up and out of CI.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('npm run test:live runs the live-data check, and npm test does not', () => {
  const scripts = JSON.parse(read('package.json')).scripts;
  assert.match(scripts['test:live'], /e2e\/live\/live-data\.e2e\.js/);
  assert.equal(scripts.test, 'node --test');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'e2e/live/live-data.e2e.js')));
});

test('the live check covers aircraft, sun, Moon, weather and the ISS, in several places, and skips feeds that are down', () => {
  const src = read('e2e/live/live-data.e2e.js');
  for (const needle of ['Seattle', 'New York', 'London', 'Hyderabad', 'Sydney', 'aircraftProxyUrl', 'sunrise-sunset.org', 'Illumination', 'open-meteo', 'celestrak', 'twoline2satrec', 'AIRCRAFT_PROXY_URL']) {
    assert.ok(src.toLowerCase().includes(needle.toLowerCase()), `mentions ${needle}`);
  }
  assert.match(src, /t\.skip\(/, 'a feed that is down is skipped');
  assert.match(src, /status >= 500 \|\| res\.status === 429/);
  assert.doesNotMatch(src, /fargems\.com|swaroop\.in|workers\.dev/, 'no site or proxy address in the repository');
});

test('the live workflow runs daily and on demand, is separate from CI, and cannot block a pull request', () => {
  const wf = read('.github/workflows/live-data.yml');
  assert.match(wf, /schedule:\s*\n\s*- cron:/);
  assert.match(wf, /workflow_dispatch:/);
  assert.doesNotMatch(wf, /pull_request|push:/, 'not triggered by pull requests or pushes');
  assert.match(wf, /npm run test:live/);
  assert.match(wf, /AIRCRAFT_PROXY_URL: \$\{\{ vars\.AIRCRAFT_PROXY_URL \}\}/, 'the proxy address comes from a repository variable');
  assert.match(wf, /permissions:\s*\n\s*contents: read/);
  assert.doesNotMatch(read('.github/workflows/ci.yml'), /test:live/, 'CI stays offline and fast');
});
