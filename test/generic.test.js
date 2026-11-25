'use strict';
// Open-source hygiene: the project must not hard-code one owner's domain or private notes.
// Anyone can host it, so the repo only describes generic hosting steps.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'tmp']);
const SKIP_FILES = new Set([path.join('test', 'generic.test.js')]);
// Tests, samples and docs use HITEC City in Hyderabad, or other cities, never the owner's home. Private patterns to keep out of the
// repo (one regular expression per line) can go in the git-ignored tmp/private-patterns.txt; they are checked too.
const BANNED = [/fargems\.com/i, /185\.199\.10[89]\.153|185\.199\.11[01]\.153/, /porkbun/i, /cloudflare account/i];
try { for (const l of fs.readFileSync(path.join(ROOT, 'tmp', 'private-patterns.txt'), 'utf8').split(/\r?\n/)) if (l.trim()) BANNED.push(new RegExp(l.trim())); } catch (e) { /* no private patterns here */ }

function files(dir = ROOT, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) files(full, out);
    else out.push(path.relative(ROOT, full));
  }
  return out;
}

test('no tracked file hard-codes a domain or DNS details', () => {
  const offenders = [];
  for (const rel of files()) {
    if (SKIP_FILES.has(rel) || /\.(png|jpg|pdf|zip)$/i.test(rel)) continue;
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const re of BANNED) if (re.test(text)) offenders.push(`${rel}: ${re}`);
  }
  assert.deepEqual(offenders, []);
});

test('the repo ships no CNAME file', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'CNAME')));
});

test('.gitignore keeps the private tmp folder out of git', () => {
  assert.match(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8'), /^\/tmp\/$/m);
});
