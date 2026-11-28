'use strict';
// The nearest object whose card shows when nothing is picked is marked on the radar and in the list as if it were picked.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

test('the card remembers which nearest object it shows, and the radar and list use it when nothing is picked', () => {
  assert.match(app, /state\.shownId = null;/, 'cleared on each card render');
  assert.match(app, /if \(nearest\) \{ state\.shownId = o\.id; state\.dirty = true; \}/);
  assert.match(app, /sel = state\.sel \|\| state\.shownId/, 'radar emphasis');
  assert.match(app, /\(state\.sel \|\| state\.shownId\) === o\.id \? ' sel'/, 'list row');
  assert.match(app, /a ring round the picked object, or the nearest one/);
});
