'use strict';
// The browser tests must start from the shared helpers (e2e/ios/helpers.js) and follow docs/TESTING.md. This fails the build when a new
// test goes round them, with the reason, so the lesson is learned from the failure and not from the next flaky CI run.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const dir = path.join(ROOT, 'e2e', 'ios');
const read = (f) => fs.readFileSync(f, 'utf8');
const files = fs.readdirSync(dir).filter((f) => /\.e2e\.js$/.test(f)).map((f) => path.join(dir, f));
const helpers = read(path.join(dir, 'helpers.js'));
const lines = (f) => read(f).split(/\r?\n/);
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');

test('there are browser test files to check, and the helpers and the guide exist', () => {
  assert.ok(files.length >= 2, files.map(rel).join());
  assert.ok(fs.existsSync(path.join(ROOT, 'docs', 'TESTING.md')), 'docs/TESTING.md');
  assert.match(helpers, /READ docs\/TESTING\.md BEFORE WRITING A NEW BROWSER TEST/, 'the helpers point to the guide');
});

test('no test changes the browser\'s own camera function: it does not stick on some builds (use openAr or fakeCamera)', () => {
  for (const f of files) lines(f).forEach((l, i) => {
    if (/\/\/\s/.test(l.split('mediaDevices')[0] || '') && !/mediaDevices\.getUserMedia\s*=/.test(l)) return;
    assert.doesNotMatch(l, /mediaDevices\.getUserMedia\s*=[^=]/, `${rel(f)}:${i + 1} assigns to navigator.mediaDevices.getUserMedia. It does not stick on some WebKit builds, and the AR tests then fail at random. Use openAr(page, sky), or fakeCamera(page) before the tap. See docs/TESTING.md rule 1.`);
  });
});

test('the AR button is never tapped without the camera put on the page first (use openAr)', () => {
  for (const f of files) {
    const L = lines(f);
    L.forEach((l, i) => {
      if (!/\.(tap|click)\('#arBtn'\)/.test(l)) return;
      assert.match((L[i - 1] || '') + ' ' + l, /await fakeCamera\(page\);/, `${rel(f)}:${i + 1} taps #arBtn without fakeCamera(page) just before it. Use openAr(page, sky), or call fakeCamera(page) first. See docs/TESTING.md rule 1.`);
    });
  }
});

// A ratchet: these fixed waits were there before the rule. Turn one into a wait for the thing (or, to prove that something does not
// happen, a bounded wait for it that reports 'stayed') and lower the number; never raise it.
const FIXED_WAITS_BEFORE_THE_RULE = 8;
test('no new test waits a fixed time with waitForTimeout (wait for the thing, with waitForFunction or waitForSelector)', () => {
  const found = [];
  for (const f of files) lines(f).forEach((l, i) => { if (/waitForTimeout\(/.test(l)) found.push(rel(f) + ':' + (i + 1)); });
  assert.ok(found.length <= FIXED_WAITS_BEFORE_THE_RULE, 'there are ' + found.length + ' uses of waitForTimeout, and no more than ' + FIXED_WAITS_BEFORE_THE_RULE + ' are allowed. Wait for what you mean (docs/TESTING.md rule 4). Found: ' + found.join(', '));
});

test('the tests do not write their own copy of a helper that already exists', () => {
  const names = ['iphone', 'linked', 'openAr', 'arShown', 'fakeCamera', 'heading', 'wikiAnswers', 'openSearch', 'typeSearch', 'tallerBy'];
  for (const f of files) {
    const src = read(f);
    for (const n of names) {
      const own = new RegExp(`^(async function ${n}\\b|const ${n} = )`, 'm');
      assert.doesNotMatch(src, own, `${rel(f)} defines its own ${n}. Use the one in e2e/ios/helpers.js (docs/TESTING.md), so a fix made there reaches every test.`);
    }
  }
});

test('a test does not use the names the test page keeps for itself', () => {
  const reserved = ['__diagClicks', '__diagErrs'];
  for (const f of files) {
    const src = read(f);
    for (const n of ['window.__clicks = [];']) {
      // allowed only inside a test that sets it up and reads it back itself (the file-saving test); helpers must not touch it
      assert.ok(!helpers.includes(n), `helpers.js must not use ${n}`);
    }
    for (const r of reserved) assert.ok(!(rel(f) !== 'e2e/ios/helpers.js' && new RegExp(`${r}\\s*=`).test(src)), `${rel(f)} assigns ${r}, which is the page diagnostics' (docs/TESTING.md rule 7)`);
  }
});

test('the helpers listed in the header and in the guide are the ones exported', () => {
  const exp = (helpers.match(/return \{ ([^}]+) \};\n\}/) || [])[1].split(',').map((x) => x.trim());
  const guide = read(path.join(ROOT, 'docs', 'TESTING.md'));
  const header = helpers.slice(0, helpers.indexOf('const assert'));
  for (const n of exp) {
    assert.ok(header.includes(n + '(') || header.includes(n + ' ('), `${n} is exported but not described in the header of helpers.js`);
    assert.ok(guide.includes('`' + n) , `${n} is exported but not in docs/TESTING.md`);
  }
  assert.match(helpers, /module\.exports = \{ createHelpers, HITEC, sleep, DESKTOP_SAFARI_UA, SAVED, FAKE_SKY, AR_SKY, PNG \};/);
});

test('the camera of the helpers is the page\'s own object and is set again before the AR button is tapped', () => {
  assert.match(helpers, /Object\.defineProperty\(navigator, 'mediaDevices', \{ value: \{ getUserMedia: async \(\) => fake \}, configurable: true, writable: true \}\)/);
  assert.match(helpers, /await fakeCamera\(page\);\s*\n\s*await page\.tap\('#arBtn'\);/, 'openAr puts the camera on the page just before the tap');
  assert.match(helpers, /did not show \| page state: /, 'and a failure says what the page was doing');
});

test('the helpers switch the outside world off, so no test depends on an answer arriving at a random moment', () => {
  const at = helpers.indexOf('await context.route((url) =>');
  assert.ok(at > 0 && helpers.slice(at, at + 260).includes('localhost') && helpers.slice(at, at + 260).includes('cdn') && helpers.slice(at, at + 260).includes('(r) => r.abort()'), 'every host but this machine and the CDN is refused');
  assert.ok(at < helpers.indexOf('await context.addInitScript('), 'and that is done before anything else is set up, so a test route registered later is asked first');
  assert.match(read(path.join(ROOT, 'docs', 'TESTING.md')), /A test never depends on the outside world/);
});

test('the browser test workflow runs when the helpers or the guide change', () => {
  const wf = read(path.join(ROOT, '.github', 'workflows', 'ios-safari.yml'));
  assert.match(wf, /e2e\/\*\*|e2e\/ios|\*\*/, 'e2e files trigger the run');
});
