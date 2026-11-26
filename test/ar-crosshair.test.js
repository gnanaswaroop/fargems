'use strict';
// A crosshair at the centre of the camera view, drawn before anything else so it is there even before the sensors start.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'ar-view.js'), 'utf8');

test('the crosshair is drawn each frame right after the canvas is cleared, with a dark edge under a light line', () => {
  assert.match(src, /ctx\.clearRect\(0, 0, W, H\);\s*crosshair\(W, H\);/);
  assert.match(src, /function crosshair\(W, H\) \{\s*const cx = W \/ 2, cy = H \/ 2, gap = 4, arm = 10;/);
  assert.match(src, /\[\[3, 'rgba\(0,0,0,\.55\)'\], \[1\.25, 'rgba\(255,255,255,\.95\)'\]\]/);
});

test('the crosshair is small: its arms reach about 14 px from the centre, enough to point with', () => {
  const m = src.match(/gap = (\d+), arm = (\d+);/);
  assert.ok(+m[1] + +m[2] <= 16, 'the cross reaches ' + (+m[1] + +m[2]) + ' px');
});
