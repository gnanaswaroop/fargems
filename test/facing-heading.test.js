'use strict';
// North must not move when the phone is raised from flat to upright and back, and a flight to the left on the radar must be
// to the left in the camera view once you turn that way.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AR = require('../lib/ar.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

// The angles a phone reports when its back camera looks toward `heading` (degrees from north) and it is tilted up by `tilt`
// degrees from lying flat (0 flat, 90 upright), with no roll.
const reading = (heading, tilt) => [(360 - heading) % 360, tilt, 0];

test('the facing direction does not change as the phone is raised from flat to upright and back', () => {
  for (const heading of [0, 37, 90, 180, 271, 359]) {
    for (let tilt = 0; tilt <= 150; tilt += 5) {
      const f = AR.facingHeading(...reading(heading, tilt));
      assert.ok(f != null && angDiff(f, heading) < 0.5, `heading ${heading}, tilt ${tilt}: got ${f}`);
    }
  }
});

test('rolling a flat phone does not move north, and a phone held a little off flat stays within a few degrees', () => {
  for (const heading of [10, 135, 250]) {
    for (const roll of [-30, -10, 10, 30]) {
      const f = AR.facingHeading((360 - heading) % 360, 0, roll);
      assert.ok(angDiff(f, heading) < 1, `flat, roll ${roll}: got ${f}`);
    }
    for (const tilt of [5, 10, 20]) {
      const f = AR.facingHeading((360 - heading) % 360, tilt, 8);
      assert.ok(angDiff(f, heading) < 6, `tilt ${tilt}, roll 8: got ${f}`);
    }
  }
});

test('the facing direction agrees with where the camera points when the phone is raised', () => {
  for (const heading of [20, 120, 300]) {
    for (const tilt of [60, 80, 90]) {
      const pose = AR.cameraPose(...reading(heading, tilt));
      assert.ok(angDiff(AR.facingHeading(...reading(heading, tilt)), pose.heading) < 1);
    }
  }
});

test('a phone with no usable direction returns null instead of a random heading', () => {
  assert.equal(AR.facingHeading(0, 179, 0), null, 'leaning right back, the camera points almost straight up');
  const f = AR.facingHeading(0, 90, 90); // upright and rolled onto its side: the camera points along the ground, sideways
  assert.ok(f == null || Number.isFinite(f));
});

test('a flight on the left of the radar is on the left of the camera view once you turn left, and ahead once you face it', () => {
  const view = { W: 400, H: 800, vfov: 63 };
  const heading = 200;                       // facing south-south-west
  const flight = { az: heading - 40, el: 20 }; // 40 degrees to the left of where you face: left on the radar
  // On the radar (compass on, east on the right): x offset is sin(az - heading), negative = left.
  assert.ok(Math.sin((flight.az - heading) * Math.PI / 180) < 0, 'left on the radar');
  // Held up facing the same way it is off to the left of the picture (or off the edge, on the left side).
  const ahead = AR.projectToScreen(flight, { heading, pitch: 20 }, view);
  assert.ok(ahead.xc < 0, 'left of the camera centre');
  // Turn left by 40 degrees and it is in front of you, near the middle of the picture.
  const turned = AR.projectToScreen(flight, { heading: heading - 40, pitch: 20 }, view);
  assert.ok(turned.onScreen && Math.abs(turned.x - view.W / 2) < 2 && Math.abs(turned.y - view.H / 2) < 2, JSON.stringify(turned));
  // The pose read from the sensors, phone upright facing that way, gives the same picture.
  const pose = AR.cameraPose((360 - (heading - 40)) % 360, 90 - 20 + 0, 0);
  assert.ok(angDiff(pose.heading, heading - 40) < 0.5);
});

test('the sky view takes its heading from where the phone faces, with tilt from the same sensor', () => {
  const app = read('app.js');
  assert.match(app, /h = window\.FarGemsAR\.facingHeading\(e\.alpha, e\.beta, e\.gamma\)/);
  assert.doesNotMatch(app, /norm360\(360 - e\.alpha\)/, 'the top-of-phone heading is gone');
  assert.match(app, /\(abs \|\| !ori\.absolute\)/, 'tilt comes from the absolute sensor when there is one');
  assert.match(app, /trueHeading\(h, state\.declination \+ state\.arOffset\.h\)/, 'still corrected from magnetic to true north');
  assert.match(read('ar-view.js'), /ori\.declination/, 'the camera view uses the same correction');
  assert.ok(read('viewer.html').indexOf('lib/ar.js') < read('viewer.html').indexOf('src="app.js"'), 'ar.js loads before app.js');
});

test('near upright, where the old top-of-phone heading swung about, the radar follows the camera', () => {
  let worstNew = 0, worstOld = 0;
  for (const alpha of [0, 90, 200, 300]) {
    for (let beta = 80; beta <= 100; beta += 2) {
      for (let gamma = -25; gamma <= 25; gamma += 5) {
        const camera = AR.cameraPose(alpha, beta, gamma).heading;
        worstNew = Math.max(worstNew, angDiff(AR.facingHeading(alpha, beta, gamma), camera));
        worstOld = Math.max(worstOld, angDiff((360 - alpha) % 360, camera)); // what the radar used before
      }
    }
  }
  assert.ok(worstNew < 6, `new heading is within ${worstNew.toFixed(1)}° of the camera`);
  assert.ok(worstOld > 15, `the old one was ${worstOld.toFixed(1)}° off, which is what made north jump`);
});
