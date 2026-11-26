'use strict';
// The workflows run third-party actions: pin them to a commit and give each job only the permissions it needs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, '..', '.github', 'workflows');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n');

test('every action is pinned to a full commit SHA', () => {
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.yml'))) {
    for (const m of read(f).matchAll(/uses:\s*(\S+)/g)) assert.match(m[1], /@[0-9a-f]{40}$/, `${f}: ${m[1]}`);
  }
});

test('only the deploy job can publish; the others are read-only', () => {
  const pages = read('pages.yml');
  assert.match(pages, /^permissions:\n  contents: read\n\nconcurrency:/m, 'read-only by default');
  assert.equal((pages.match(/pages: write/g) || []).length, 1);
  assert.equal((pages.match(/id-token: write/g) || []).length, 1);
  assert.match(pages, /deploy:\n[\s\S]*?permissions:\n      contents: read\n      pages: write\n      id-token: write/);
  for (const f of ['ci.yml', 'ios-safari.yml', 'live-data.yml']) assert.doesNotMatch(read(f), /: write/, f);
});

test('Dependabot keeps the actions and the browser-test packages current', () => {
  const d = fs.readFileSync(path.join(__dirname, '..', '.github', 'dependabot.yml'), 'utf8');
  assert.match(d, /package-ecosystem: github-actions/);
  assert.match(d, /package-ecosystem: npm\s+directory: \/e2e\/ios/);
});
