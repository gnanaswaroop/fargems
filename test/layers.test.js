'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../lib/logic.js');

test('LAYER_KEYS lists every layer and each has a label', () => {
  assert.deepEqual(L.LAYER_KEYS, ['air', 'sat', 'sky', 'met', 'star', 'grid', 'labels', 'radar']);
  for (const k of L.LAYER_KEYS) assert.ok(typeof L.LAYER_LABELS[k] === 'string' && L.LAYER_LABELS[k].length > 0, k);
});

test('defaultLayers turns everything on, and the radar off for reduced motion', () => {
  const d = L.defaultLayers();
  for (const k of L.LAYER_KEYS) assert.equal(d[k], true, k);
  assert.equal(L.defaultLayers(true).radar, false);
  assert.equal(L.defaultLayers(true).air, true, 'reduced motion only affects the radar');
});

test('toggleLayer flips one layer and leaves the others alone', () => {
  const before = L.defaultLayers();
  const after = L.toggleLayer(before, 'sat');
  assert.equal(after.sat, false);
  assert.equal(after.air, true);
  assert.equal(before.sat, true, 'input is not mutated');
  assert.equal(L.toggleLayer(after, 'sat').sat, true, 'toggling twice restores it');
});

test('toggleLayer ignores unknown keys', () => {
  const before = L.defaultLayers();
  const after = L.toggleLayer(before, 'nope');
  assert.deepEqual(after, before);
  assert.notEqual(after, before, 'returns a copy');
});

test('sweepAngle advances by elapsed time and wraps at 360', () => {
  assert.equal(L.sweepAngle(0, 200, 4000), 18, '200 ms of a 4 s turn is 18 degrees');
  assert.equal(L.sweepAngle(350, 200, 4000), 8, '350 + 18 wraps to 8');
  assert.equal(L.sweepAngle(0, 0, 4000), 0);
});

test('sweepAngle clamps long gaps so the sweep never jumps a full turn', () => {
  // A 10 s gap (hidden tab) moves at most 250 ms worth of sweep.
  assert.equal(L.sweepAngle(0, 10000, 4000), 360 * 250 / 4000);
  assert.equal(L.sweepAngle(0, -500, 4000), 0, 'negative time does not move the sweep');
  assert.equal(L.sweepAngle(0, NaN, 4000), 0, 'bad time does not move the sweep');
});

test('sweepAngle keeps a safe period when the period is invalid', () => {
  assert.equal(L.sweepAngle(45, 100, 0), 45);
  assert.equal(L.sweepAngle(45, 100, -1), 45);
});

test('sweepWedge returns steps slices that trail behind the sweep and fade out', () => {
  const w = L.sweepWedge(100, 60, 24);
  assert.equal(w.length, 24);
  assert.equal(w[0].to, 100, 'newest slice ends at the sweep line');
  assert.ok(Math.abs(w[0].alpha - 0.32) < 1e-9, 'newest is the strongest');
  for (let i = 1; i < w.length; i++) assert.ok(w[i].alpha < w[i - 1].alpha, 'alpha decreases');
  assert.ok(w[w.length - 1].alpha > 0, 'the trail never reaches zero alpha inside the array');
});

test('sweepWedge wraps across north without negative or out-of-range angles', () => {
  const w = L.sweepWedge(10, 60, 6);
  for (const s of w) {
    assert.ok(s.from >= 0 && s.from < 360, `from ${s.from}`);
    assert.ok(s.to >= 0 && s.to < 360, `to ${s.to}`);
  }
});
