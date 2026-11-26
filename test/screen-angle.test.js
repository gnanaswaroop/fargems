'use strict';
// A tablet's sensors belong to the device, and the device's natural position is sideways. The compass has to follow the top
// of the screen, whichever way the screen is turned.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AR = require('../lib/ar.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

// Angles for a flat device whose own x axis (its right-hand side) points toward `heading`.
const flatWithXAt = (heading) => (90 - heading + 360) % 360;

test('the screen angle turns the facing direction: with the device flat, the top of the screen is the device y axis turned by the angle', () => {
  for (const heading of [0, 45, 135, 200, 310]) {
    // Angle 0: the top of the device is the top of the screen.
    assert.ok(angDiff(AR.facingHeading((360 - heading) % 360, 0, 0, 0), heading) < 0.5, 'angle 0, heading ' + heading);
    assert.ok(angDiff(AR.facingHeading((360 - heading) % 360, 0, 0), heading) < 0.5, 'no angle given means 0');
    // Angle 90: the screen is turned a quarter, so its top is the device x axis.
    assert.ok(angDiff(AR.facingHeading(flatWithXAt(heading), 0, 0, 90), heading) < 0.5, 'angle 90, heading ' + heading);
    // Angle 270: its top is the opposite of the device x axis.
    assert.ok(angDiff(AR.facingHeading(flatWithXAt((heading + 180) % 360), 0, 0, 270), heading) < 0.5, 'angle 270, heading ' + heading);
    // Angle 180: upside down.
    assert.ok(angDiff(AR.facingHeading((360 - (heading + 180) % 360) % 360, 0, 0, 180), heading) < 0.5, 'angle 180, heading ' + heading);
  }
});

test('the same device read without the angle is a quarter turn out: the bug on a tablet that is naturally sideways', () => {
  const alpha = flatWithXAt(100); // the screen top (angle 90) points at 100
  assert.ok(angDiff(AR.facingHeading(alpha, 0, 0, 90), 100) < 0.5);
  assert.ok(angDiff(AR.facingHeading(alpha, 0, 0, 0), 100) > 80, 'ignoring the angle gives a heading a quarter turn away');
});

test('with the tablet raised upright the facing direction is where the camera points, whichever way the screen is turned', () => {
  for (const heading of [20, 120, 250, 330]) {
    // Angle 90, screen top (device x axis) pointing up: gamma -90. The camera looks along the ground.
    const a = flatWithXAt(heading);
    const f = AR.facingHeading(a, 0, -90, 90), cam = AR.cameraPose(a, 0, -90).heading;
    assert.ok(angDiff(cam, heading) < 0.5, 'the camera points at ' + heading + ': ' + cam);
    assert.ok(angDiff(f, heading) < 0.5, 'angle 90 raised: ' + f);
  }
});

test('north does not move as a sideways tablet is raised from flat to upright', () => {
  for (const heading of [15, 140, 260]) {
    const alpha = flatWithXAt(heading);
    let worst = 0;
    for (let tilt = 0; tilt <= 90; tilt += 5) {
      // Raising the screen top (the device x axis) from flat toward up is a roll about the device y axis: gamma goes 0 to -90.
      const f = AR.facingHeading(alpha, 0, -tilt, 90);
      assert.ok(f != null, 'tilt ' + tilt);
      worst = Math.max(worst, angDiff(f, heading));
    }
    assert.ok(worst < 1, 'heading ' + heading + ' drifted by ' + worst);
  }
});

test('the app reads the screen angle from the browser, and turns the iPhone and iPad heading the same way', () => {
  const app = read('app.js');
  assert.match(app, /function screenAngle\(\) \{[\s\S]*screen\.orientation\.angle[\s\S]*window\.orientation[\s\S]*return 0;/);
  assert.match(app, /facingHeading\(e\.alpha, e\.beta, e\.gamma, screenAngle\(\)\)/);
  assert.match(app, /if \(typeof e\.webkitCompassHeading === 'number'\) h = window\.FarGemsLogic\.norm360\(e\.webkitCompassHeading \+ appleTurn\(\)\);/, 'the heading of the top of the device, turned to the top of the screen');
});
