'use strict';
// The two guides must exist, say the important things, stay true to the code, and keep private addresses out.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('the README links to both guides, and the links point at real files', () => {
  const readme = read('README.md');
  for (const f of ['docs/LOCAL_SETUP.md', 'docs/IMPLEMENTATION.md']) {
    assert.ok(readme.includes(`(${f})`), `README links ${f}`);
    assert.ok(fs.existsSync(path.join(__dirname, '..', f)), `${f} exists`);
  }
});

test('every local link in the guides points at a file that exists', () => {
  for (const doc of ['docs/LOCAL_SETUP.md', 'docs/IMPLEMENTATION.md']) {
    for (const m of read(doc).matchAll(/\]\(([^)#]+)(#[^)]*)?\)/g)) {
      if (/^(https?:|mailto:)/.test(m[1])) continue;
      assert.ok(fs.existsSync(path.join(__dirname, '..', 'docs', m[1])), `${doc} links ${m[1]}`);
    }
  }
});

test('the local setup guide covers the steps and every npm script it mentions exists', () => {
  const doc = read('docs/LOCAL_SETUP.md');
  for (const needle of ['npm test', 'npm run serve', 'npm run worker:dev', 'npm run serve:https', 'npm run test:live', 'npm run test:android', 'config.js', 'ALLOWED_ORIGINS', 'ENABLED', 'AIRCRAFT_PROXY_URL', 'PAGES_DOMAIN', 'secure context', 'Troubleshooting']) {
    assert.ok(doc.includes(needle), `mentions ${needle}`);
  }
  const scripts = JSON.parse(read('package.json')).scripts;
  for (const m of doc.matchAll(/npm run ([a-z:-]+)/g)) assert.ok(scripts[m[1]], `npm run ${m[1]} exists in package.json`);
});

test('the implementation guide explains permissions, compass, AR, providers and tests', () => {
  const doc = read('docs/IMPLEMENTATION.md');
  for (const needle of ['## 3. Permissions', '## 5. Compass detection', '## 7. The camera (AR) view', '## 8. Data providers and the proxy',
    'declination', 'webkitCompassHeading', 'deviceorientationabsolute', 'requestPermission', 'getUserMedia', 'hysteresis', 'Retry-After', 'cooldown', 'X-Cache: STALE', 'kill switch', 'ALLOWED_ORIGINS']) {
    assert.ok(doc.includes(needle), `mentions ${needle}`);
  }
});

test('the numbers in the implementation guide match the code', () => {
  const doc = read('docs/IMPLEMENTATION.md'), AR = require('../lib/ar.js'), L = require('../lib/logic.js');
  assert.ok(doc.includes('**−15°**') && AR.ENTER_PITCH === -15, 'open threshold');
  assert.ok(doc.includes('**−40°**') && AR.EXIT_PITCH === -40, 'close threshold');
  assert.ok(doc.includes('**700 ms**') && AR.HOLD_MS === 700, 'hold time');
  assert.ok(doc.includes('**63°**') && /VFOV = 63/.test(read('ar-view.js')), 'field of view');
  assert.ok(doc.includes('default 25 km') && L.DEFAULT_FLIGHT_RANGE_KM === 25, 'farthest flight');
  for (const [text, re] of [['AIRCRAFT_FRESH_S = 30', /AIRCRAFT_FRESH_S = 30, AIRCRAFT_STALE_S = 180/], ['ROUTE 1800/600/86400', /ROUTE_FRESH_S = 1800, ROUTE_MISS_FRESH_S = 600, ROUTE_STALE_S = 86400/], ['TLE 21600/259200', /TLE_FRESH_S = 21600, TLE_STALE_S = 259200/], ['timeout 6000', /PROVIDER_TIMEOUT_MS = 6000/]]) {
    assert.match(read('worker/aircraft-proxy.mjs'), re, text);
  }
  assert.ok(/\| `\/aircraft[^|]*\|[^|]*\| 30 s \| 3 min \|/.test(doc), 'aircraft cache times in the table');
  assert.ok(doc.includes('element sets as plain text | 6 h | 3 days |'), 'satellite cache times in the table');
});

test('the guides keep the site address, the proxy address and personal details out of the repository', () => {
  for (const f of ['README.md', 'docs/LOCAL_SETUP.md', 'docs/IMPLEMENTATION.md']) {
    const doc = read(f);
    assert.doesNotMatch(doc, /fargems\.com|swaroop.in|https?:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/i, `${f} has no real site or proxy address`);
    assert.doesNotMatch(doc, /@(gmail|outlook|hotmail|yahoo)\./i, `${f} has no personal email`);
  }
});
