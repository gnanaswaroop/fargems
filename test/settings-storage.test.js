'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../lib/logic.js');

test('loadLayers starts from the defaults when nothing is saved', () => {
  assert.deepEqual(L.loadLayers(null, false), L.defaultLayers(false));
  assert.deepEqual(L.loadLayers('not json', false), L.defaultLayers(false));
});

test('loadLayers applies saved on/off choices and keeps defaults for missing keys', () => {
  const saved = JSON.stringify({ air: false, sat: true, radar: false });
  const l = L.loadLayers(saved, false);
  assert.equal(l.air, false);
  assert.equal(l.sat, true);
  assert.equal(l.radar, false);
  assert.equal(l.grid, true, 'a key that was not saved keeps its default');
});

test('loadLayers ignores unknown keys and non-boolean values', () => {
  const l = L.loadLayers(JSON.stringify({ hacked: true, air: 'yes', sat: 0 }), false);
  assert.equal(l.hacked, undefined);
  assert.equal(l.air, true, 'a non-boolean value is ignored');
  assert.equal(l.sat, true, 'a number is not treated as a boolean choice');
  assert.deepEqual(Object.keys(l).sort(), [...L.LAYER_KEYS].sort());
});

test('loadLayers respects reduced motion for the radar default', () => {
  assert.equal(L.loadLayers(null, true).radar, false);
  assert.equal(L.loadLayers(JSON.stringify({}), true).radar, false);
});
