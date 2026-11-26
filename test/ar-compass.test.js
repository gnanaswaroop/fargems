'use strict';
// The compass points around the horizon in the camera view: eight directions as poles, magnetic north when it differs, and edge arrows for the ones out of the picture.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AR = require('../lib/ar.js');
const src = fs.readFileSync(path.join(__dirname, '..', 'ar-view.js'), 'utf8');

test('the points are the eight directions in order, with North the one marked as north', () => {
  const p = AR.compassPoints(0);
  assert.deepEqual(p.map((x) => [x.name, x.az]), [['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315]]);
  assert.deepEqual(p.filter((x) => x.major).map((x) => x.name), ['N', 'E', 'S', 'W']);
  assert.deepEqual(p.filter((x) => x.north).map((x) => x.name), ['N']);
  assert.equal(p.some((x) => x.mag), false, 'no magnetic north marker while it is the same as true north');
});

test('magnetic north is added at minus the declination, wrapped into 0 to 360', () => {
  assert.deepEqual(AR.compassPoints(0.4).some((x) => x.mag), false, 'under half a degree is not worth a marker');
  const east = AR.compassPoints(5).find((x) => x.mag), west = AR.compassPoints(-12).find((x) => x.mag);
  assert.equal(east.name, 'Mag N'); assert.equal(east.az, 355, 'with true north east of magnetic north, magnetic north is west of north');
  assert.equal(west.az, 12);
  assert.equal(AR.compassPoints(NaN).length, 8); assert.equal(AR.compassPoints(undefined).length, 8); assert.equal(AR.compassPoints(null).length, 8);
});

test('a pole stands on the horizon and goes up, so the marker has a height in the picture', () => {
  const view = { W: 400, H: 800, vfov: 60 }, cam = { heading: 0, pitch: 0 };
  const base = AR.projectToScreen({ az: 0, el: 0 }, cam, view), top = AR.projectToScreen({ az: 0, el: 12 }, cam, view);
  assert.ok(base.onScreen && top.onScreen && top.y < base.y - 60, 'the top is clearly above the foot: ' + (base.y - top.y));
  const behind = AR.projectToScreen({ az: 180, el: 0 }, cam, view);
  assert.equal(behind.front, false, 'a point behind the camera is not drawn as a pole');
});

test('the camera view draws every point as a pole, magnetic north dashed, and arrows for the major points that are off screen', () => {
  assert.match(src, /drawCompass\(cam, view, W, H, ori\.declination\);/);
  assert.match(src, /for \(const pt of AR\.compassPoints\(declination\)\)/);
  assert.match(src, /if \(pt\.mag\) ctx\.setLineDash\(\[5, 4\]\);/);
  assert.match(src, /else if \(pt\.major && !pt\.mag\) \{[\s\S]*?away\.push\(/);
  assert.match(src, /for \(const side of \[-1, 1\]\)[\s\S]*?sort\(\(a, b\) => Math\.abs\(a\.rel\) - Math\.abs\(b\.rel\)\)/, 'arrows on one edge are stacked, the nearer first');
});
