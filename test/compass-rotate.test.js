'use strict';
// The compass when the screen is turned between portrait and landscape: the heading follows the top of the screen (also on
// iPhone and iPad), and it catches up with a big change at once instead of drifting there.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AR = require('../lib/ar.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const diff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

test('the further away the new reading, the faster the heading follows', () => {
  assert.equal(AR.smoothFactor(2), 0.25);
  assert.equal(AR.smoothFactor(-10), 0.4);
  assert.equal(AR.smoothFactor(30), 0.7);
  assert.equal(AR.smoothFactor(-90), 1);
  assert.equal(AR.smoothFactor(180), 1);
  assert.ok(AR.smoothFactor(5) <= AR.smoothFactor(15) && AR.smoothFactor(15) <= AR.smoothFactor(40) && AR.smoothFactor(40) <= AR.smoothFactor(70));
});

test('a quarter turn is followed in one step, and a 40 degree change within six', () => {
  assert.equal(AR.followHeading(0, 90, false), 90, 'a quarter turn: all the way');
  assert.equal(AR.followHeading(350, 80, false), 80, 'across north, the short way');
  let h = 0, steps = 0;
  while (diff(h, 40) > 3 && steps < 20) { h = AR.followHeading(h, 40, false); steps++; }
  assert.ok(steps <= 6, 'a 40 degree change takes ' + steps + ' steps');
  // Before: 0.25 per step needed this many steps for a quarter turn.
  let old = 0, n = 0; while (diff(old, 90) > 3 && n < 100) { old += (90 - old) * 0.25; n++; }
  assert.ok(n >= 10, 'the old fixed smoothing needed ' + n + ' steps for a quarter turn');
});

test('small differences are still smoothed, so a steady compass does not jitter', () => {
  let h = 100;
  h = AR.followHeading(h, 103, false);
  assert.ok(Math.abs(h - 100.75) < 1e-9, 'a 3 degree wobble moves a quarter of the way: ' + h);
  assert.equal(AR.followHeading(null, 77, false), 77, 'no heading yet: take the first reading');
});

test('right after a turn the heading snaps to the sensor', () => {
  assert.equal(AR.followHeading(10, 14, true), 14, 'even a small difference is followed exactly while snapping');
  assert.equal(AR.followHeading(10, 370, true), 10);
  assert.equal(AR.followHeading(200, -20, true), 340);
});

test('the app turns the screen heading on iPhone and iPad too, and snaps after a turn', () => {
  const app = read('app.js'), ar = read('ar-view.js');
  assert.match(app, /function appleTurn\(\) \{[\s\S]*window\.orientation \+ 360\) % 360[\s\S]*return screenAngle\(\);/);
  assert.match(app, /ori\.compassHeading = window\.FarGemsLogic\.norm360\(e\.webkitCompassHeading \+ appleTurn\(\)\)/, 'the camera view gets the turned heading too');
  assert.match(app, /state\.heading = window\.FarGemsAR\.followHeading\(state\.heading, h, Date\.now\(\) < \(state\.snapUntil \|\| 0\)\)/);
  assert.match(app, /screen\.orientation\.addEventListener\('change', noteTurn\)/);
  assert.match(app, /addEventListener\('orientationchange', noteTurn\)/);
  assert.match(app, /if \(now !== landscape\) \{ landscape = now; noteTurn\(\); \}/, 'a browser with no turn event: the window changing shape is one');
  assert.match(app, /state\.snapUntil = Date\.now\(\) \+ 600;[\s\S]*arView\.resetHeading\(\)/);
  assert.match(app, /\n  watchTurns\(\);/);
  assert.match(ar, /AR\.followHeading\(heading, trueHead, false\)/);
  assert.match(ar, /resetHeading: \(\) => \{ heading = null; \}/);
  assert.doesNotMatch(app, /state\.heading \+ d \* 0\.25/, 'no more fixed smoothing in the radar');
});
