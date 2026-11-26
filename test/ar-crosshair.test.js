'use strict';
// A crosshair at the centre of the camera view, drawn before anything else so it is there even before the sensors start.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'ar-view.js'), 'utf8');

test('the crosshair is drawn each frame right after the canvas is cleared, with a dark edge under a light line', () => {
  assert.match(src, /ctx\.clearRect\(0, 0, W, H\);\s*crosshair\(W, H\);/);
  assert.match(src, /function crosshair\(W, H\) \{\s*const cx = W \/ 2, cy = H \/ 2, gap = 6, arm = 18;/);
  assert.match(src, /\[\[4, 'rgba\(0,0,0,\.55\)'\], \[1\.5, 'rgba\(255,255,255,\.95\)'\]\]/);
});
