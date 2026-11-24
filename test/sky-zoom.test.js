'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../lib/logic.js');

const W = 400, R0 = W / 2 - 26; // canvas size and base radius, as the sky view computes them

// Centre of the dome for a view, in canvas pixels.
const centre = (v) => ({ x: W / 2 + v.panX, y: W / 2 + v.panY });
const radius = (v) => R0 * v.zoom;

test('clampZoom keeps zoom between 1x and 6x', () => {
  assert.equal(L.clampZoom(0.2), 1);
  assert.equal(L.clampZoom(3), 3);
  assert.equal(L.clampZoom(99), 6);
  assert.equal(L.clampZoom(NaN), 1, 'bad values fall back to 1x');
});

test('resetView returns to 1x, centred, with no pan', () => {
  assert.deepEqual(L.resetView(), { zoom: 1, panX: 0, panY: 0 });
});

test('zoomAt keeps the point under the cursor fixed on screen', () => {
  const v0 = { zoom: 1, panX: 0, panY: 0 };
  const px = 300, py = 150; // a point off-centre
  const rel = (v) => ({ x: (px - centre(v).x) / radius(v), y: (py - centre(v).y) / radius(v) });
  const v1 = L.zoomAt(v0, 2.5, px, py, W);
  assert.equal(v1.zoom, 2.5);
  const a = rel(v0), b = rel(v1);
  assert.ok(Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9, 'same position relative to the dome');
});

test('zoomAt clamps and zooming back out to 1x recentres when no pan was applied', () => {
  const v = L.zoomAt({ zoom: 1, panX: 0, panY: 0 }, 50, 200, 200, W);
  assert.equal(v.zoom, 6, 'clamped to 6x');
  const back = L.zoomAt(v, 1, 200, 200, W);
  assert.equal(back.zoom, 1);
  assert.ok(Math.abs(back.panX) < 1e-9 && Math.abs(back.panY) < 1e-9);
});

test('panBy moves the view and keeps the dome within reach of the canvas', () => {
  const v = L.panBy({ zoom: 3, panX: 0, panY: 0 }, 40, -25, W);
  assert.equal(v.panX, 40);
  assert.equal(v.panY, -25);
  const far = L.panBy({ zoom: 3, panX: 0, panY: 0 }, 100000, 0, W);
  assert.ok(far.panX <= W * 1.5, 'pan is limited so the view cannot be lost');
});

test('panBy does nothing at 1x, where dragging rotates the sky instead', () => {
  const v = L.panBy({ zoom: 1, panX: 0, panY: 0 }, 40, 10, W);
  assert.deepEqual(v, { zoom: 1, panX: 0, panY: 0 });
});

test('pinchZoom returns the zoom factor for a change in finger distance', () => {
  assert.equal(L.pinchFactor(100, 200), 2, 'fingers spread apart: zoom in');
  assert.equal(L.pinchFactor(200, 100), 0.5, 'fingers close: zoom out');
  assert.equal(L.pinchFactor(0, 100), 1, 'no distance yet: no change');
});
