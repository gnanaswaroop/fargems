'use strict';
// Checks that local-only files stay out of git: the root /tmp folder (notes, certificates,
// zip archives) is ignored, and the rule is anchored so nested folders are not hidden.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

const hasGit = () => {
  try { execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: ROOT, stdio: 'ignore' }); return true; }
  catch { return false; }
};
const ignored = (p) => {
  try {
    execFileSync('git', ['check-ignore', '-q', p], { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch (e) {
    if (e.status === 1) return false; // not ignored
    throw e;
  }
};

test('.gitignore anchors the tmp rule to the repo root', () => {
  const lines = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim());
  assert.ok(lines.includes('/tmp/'), 'has /tmp/ rule');
  assert.ok(!lines.includes('tmp/'), 'no unanchored tmp/ rule that would hide nested folders');
});

test('files under the root tmp folder are ignored by git', { skip: !hasGit() && 'not a git checkout' }, () => {
  assert.equal(ignored('tmp/fargems-details.md'), true);
  assert.equal(ignored('tmp/certs/key.pem'), true);
  assert.equal(ignored('tmp/fargems.zip'), true);
});

test('a nested folder named tmp is not ignored', { skip: !hasGit() && 'not a git checkout' }, () => {
  assert.equal(ignored('lib/tmp/example.js'), false);
});
