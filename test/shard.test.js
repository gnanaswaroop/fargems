'use strict';
// The browser tests run as shards at the same time in CI. Splitting must lose no test and run none twice.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { owner, parseShard } = require('../e2e/ios/shard.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');

test('every test belongs to exactly one shard, and the shards are balanced', () => {
  for (let total = 1; total <= 8; total++) {
    const counts = new Array(total).fill(0);
    for (let n = 0; n < 101; n++) {
      const o = owner(n, total);
      assert.ok(o >= 1 && o <= total, `test ${n} of ${total}`);
      counts[o - 1]++;
    }
    assert.equal(counts.reduce((a, b) => a + b, 0), 101);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, 'balanced: ' + counts);
  }
});

test('FG_SHARD is read as index/total, and anything odd means run everything', () => {
  assert.deepEqual(parseShard('2/4'), { index: 2, total: 4 });
  assert.deepEqual(parseShard(' 1/1 '), { index: 1, total: 1 });
  for (const bad of [undefined, '', 'x', '0/4', '5/4', '2/0', '2', '2/', '/4', '-1/4', '1/4/4']) assert.deepEqual(parseShard(bad), { index: 1, total: 1 }, String(bad));
});

test('run as separate processes, the shards together run each test exactly once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-shard-'));
  const file = path.join(dir, 'sample.test.js');
  const shardJs = path.join(__dirname, '..', 'e2e', 'ios', 'shard.js').replace(/\\/g, '/');
  fs.writeFileSync(file, `const { test } = require(${JSON.stringify(shardJs)});\nfor (let i = 1; i <= 10; i++) test('case ' + i, () => {});\n`);
  const clean = { ...process.env }; delete clean.NODE_TEST_CONTEXT; // we are inside a test run; the child must report on its own
  const names = [];
  for (let i = 1; i <= 3; i++) {
    const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', file], { env: { ...clean, FG_SHARD: i + '/3' }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    for (const m of r.stdout.matchAll(/✔ (case \d+)/g)) names.push(m[1]);
  }
  assert.equal(names.length, 10, 'ten tests in all: ' + names.join(','));
  assert.equal(new Set(names).size, 10, 'none twice');
  const all = spawnSync(process.execPath, ['--test', '--test-reporter=spec', file], { env: { ...clean, FG_SHARD: '' }, encoding: 'utf8' });
  assert.equal([...all.stdout.matchAll(/✔ (case \d+)/g)].length, 10, 'with no FG_SHARD all of them run');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the browser test files use the sharding loader, and CI runs four shards with one result to look at', () => {
  for (const f of ['e2e/ios/safari.e2e.js', 'e2e/ios/android-tablet.e2e.js']) {
    const src = read(f);
    assert.match(src, /const \{ test \} = require\('\.\/shard\.js'\);/, f);
    assert.doesNotMatch(src, /require\('node:test'\)/, f + ' must not bypass the sharding');
  }
  const wf = read('.github/workflows/ios-safari.yml');
  assert.match(wf, /strategy:\n\s+fail-fast: false\n\s+matrix:\n\s+include:/, 'shards that all finish even if one fails');
  const jobs = [...wf.matchAll(/- \{ id: '([^']+)', browser: (\w+), file: ([^,]+), shard: '(\d+)\/(\d+)' \}/g)].map((m) => ({ id: m[1], browser: m[2], file: m[3], i: +m[4], n: +m[5] }));
  const web = jobs.filter((j) => j.browser === 'webkit'), chr = jobs.filter((j) => j.browser === 'chromium');
  assert.equal(web.length, 5, 'five Safari shards');
  assert.deepEqual(web.map((j) => j.i), [1, 2, 3, 4, 5]);
  assert.ok(web.every((j) => j.n === 5 && j.file === 'e2e/ios/safari.e2e.js'), 'each takes a fifth of the Safari tests');
  assert.equal(chr.length, 1, 'one job for the Android tablet tests');
  assert.deepEqual([chr[0].file, chr[0].i, chr[0].n], ['e2e/ios/android-tablet.e2e.js', 1, 1]);
  assert.match(wf, /FG_SHARD: \$\{\{ matrix\.shard \}\}/);
  assert.match(wf, /npx playwright install --with-deps \$\{\{ matrix\.browser \}\}/, 'each job installs only its own browser');
  assert.match(wf, /uses: actions\/cache@[0-9a-f]{40} # v4\n\s+with:\n\s+path: ~\/\.cache\/ms-playwright\n\s+key: playwright-\$\{\{ matrix\.browser \}\}-\$\{\{ hashFiles\('e2e\/ios\/package-lock\.json'\) \}\}/, 'the browsers are kept between runs');
  assert.match(wf, /run: node --test --test-reporter=spec \$\{\{ matrix\.file \}\}/);
  assert.match(wf, /\n  safari:\n    name: safari\n    needs: shard\n    if: \$\{\{ always\(\) \}\}/, 'one job called safari that waits for every shard');
  assert.match(wf, /test "\$\{\{ needs\.shard\.result \}\}" = "success"/, 'and fails unless all of them passed');
});
