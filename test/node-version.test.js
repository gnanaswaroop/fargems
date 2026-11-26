'use strict';
// The workflows run on Node 24: the project's own scripts, and the GitHub actions themselves (older releases of the
// actions run on Node 20, which GitHub is retiring and warns about on every run).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, '..', '.github', 'workflows');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.yml'));

// First release of each action that runs on Node 24.
const MIN = { 'actions/checkout': 5, 'actions/setup-node': 5, 'actions/cache': 5, 'actions/upload-pages-artifact': 4, 'actions/deploy-pages': 5 };

test('every workflow runs the project scripts on Node 24', () => {
  for (const f of files) {
    const wf = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of wf.matchAll(/node-version: '(\d+)'/g)) assert.equal(m[1], '24', f);
  }
});

test('the GitHub actions are releases that run on Node 24, each pinned to a commit', () => {
  let seen = 0;
  for (const f of files) {
    const wf = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of wf.matchAll(/uses: (actions\/[\w-]+)@([0-9a-f]{40}) # v(\d+)\.\d+\.\d+/g)) {
      seen++;
      if (MIN[m[1]]) assert.ok(+m[3] >= MIN[m[1]], f + ': ' + m[1] + ' v' + m[3] + ' runs on Node 20');
    }
    assert.doesNotMatch(wf, /uses: actions\/[\w-]+@(?![0-9a-f]{40} )/, f + ': every action is pinned to a commit');
  }
  assert.ok(seen >= 10, 'found the actions: ' + seen);
});
