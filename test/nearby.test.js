'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../lib/logic.js');

test('describeDirection gives a compass point and height in words', () => {
  assert.equal(L.describeDirection(45, 30), 'NE · 30° up');
  assert.equal(L.describeDirection(180, -5), 'S · 5° below the horizon');
  assert.equal(L.describeDirection(0, 90), 'N · overhead');
});

test('describeDirection relative to your heading tells you where to turn', () => {
  // facing north (heading 0): an object to the east is on your right
  assert.match(L.describeDirection(90, 10, 0), /right/);
  assert.match(L.describeDirection(270, 10, 0), /left/);
  assert.match(L.describeDirection(5, 10, 0), /ahead/);
  assert.match(L.describeDirection(180, 10, 0), /behind/);
});

test('describeDirection handles a missing heading and bad numbers', () => {
  assert.equal(L.describeDirection(NaN, 10), '–');
  assert.doesNotMatch(L.describeDirection(90, 10, null), /right|left|ahead|behind/, 'no heading: compass point only');
});

test('sortNearest puts the closest first and unknown distances last', () => {
  const list = [
    { name: 'Star', distKm: null },
    { name: 'Far', distKm: 384400 },
    { name: 'Near', distKm: 12.5 },
    { name: 'Mid', distKm: 800 },
  ];
  assert.deepEqual(L.sortNearest(list).map((o) => o.name), ['Near', 'Mid', 'Far', 'Star']);
  assert.equal(list[0].name, 'Star', 'the input is not reordered');
});

test('formatDistance uses km, thousands separators and AU for planets', () => {
  assert.equal(L.formatDistance(12.4), '12 km');
  assert.equal(L.formatDistance(384400), '384,400 km');
  assert.equal(L.formatDistance(null), 'distance unknown');
  assert.equal(L.formatDistance(149597870.7 * 0.7), '0.7 AU', 'large distances above a few AU are shown in AU');
});

test('swipeDirection reads a clear horizontal swipe and ignores small or vertical moves', () => {
  assert.equal(L.swipeDirection(-120, 10), 'left');
  assert.equal(L.swipeDirection(120, -5), 'right');
  assert.equal(L.swipeDirection(30, 0), null, 'too short');
  assert.equal(L.swipeDirection(90, 200), null, 'mostly vertical: a scroll, not a swipe');
});
