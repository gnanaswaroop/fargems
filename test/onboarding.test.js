'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../lib/onboarding.js');

// Minimal in-memory storage with the same shape as localStorage.
const memStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m };
};
const throwingStorage = () => ({
  getItem() { throw new Error('blocked'); },
  setItem() { throw new Error('blocked'); },
});

test('parseCoords accepts comma and space separators, signs and decimals', () => {
  assert.deepEqual(O.parseCoords('22.57, 88.36'), { lat: 22.57, lon: 88.36 });
  assert.deepEqual(O.parseCoords('22.57 88.36'), { lat: 22.57, lon: 88.36 });
  assert.deepEqual(O.parseCoords('-33.9, 151.2'), { lat: -33.9, lon: 151.2 });
  assert.deepEqual(O.parseCoords('  0,0  '), { lat: 0, lon: 0 });
});

test('parseCoords rejects out-of-range, incomplete and non-numeric input', () => {
  assert.equal(O.parseCoords('91, 10'), null);
  assert.equal(O.parseCoords('10, 181'), null);
  assert.equal(O.parseCoords('22.57'), null);
  assert.equal(O.parseCoords('hello'), null);
  assert.equal(O.parseCoords(''), null);
  assert.equal(O.parseCoords(null), null);
});

test('storeLocation saves valid coordinates under the viewer key', () => {
  const s = memStorage();
  assert.equal(O.storeLocation(s, 22.57, 88.36), true);
  assert.equal(s.getItem(O.LOC_KEY), '{"lat":22.57,"lon":88.36}');
});

test('storeLocation refuses out-of-range or non-finite values and stores nothing', () => {
  const s = memStorage();
  assert.equal(O.storeLocation(s, 95, 0), false);
  assert.equal(O.storeLocation(s, 0, -200), false);
  assert.equal(O.storeLocation(s, NaN, 0), false);
  assert.equal(O.storeLocation(s, '10', 10), false, 'strings are not coordinates');
  assert.equal(s.getItem(O.LOC_KEY), null);
});

test('storeLocation returns false when storage throws', () => {
  assert.equal(O.storeLocation(throwingStorage(), 1, 2), false);
});

test('readLocation round-trips a stored location', () => {
  const s = memStorage();
  O.storeLocation(s, -33.9, 151.2);
  assert.deepEqual(O.readLocation(s), { lat: -33.9, lon: 151.2 });
});

test('readLocation returns null for missing, corrupt or out-of-range data', () => {
  assert.equal(O.readLocation(memStorage()), null);
  assert.equal(O.readLocation(memStorage({ [O.LOC_KEY]: '{not json' })), null);
  assert.equal(O.readLocation(memStorage({ [O.LOC_KEY]: '{"lat":120,"lon":0}' })), null);
  assert.equal(O.readLocation(memStorage({ [O.LOC_KEY]: '{"lat":"1","lon":2}' })), null);
  assert.equal(O.readLocation(memStorage({ [O.LOC_KEY]: 'null' })), null);
  assert.equal(O.readLocation(throwingStorage()), null);
});

test('storeCompass accepts only granted, denied or na', () => {
  const s = memStorage();
  assert.equal(O.storeCompass(s, 'granted'), true);
  assert.equal(O.readCompass(s), 'granted');
  assert.equal(O.storeCompass(s, 'denied'), true);
  assert.equal(O.readCompass(s), 'denied');
  assert.equal(O.storeCompass(s, 'maybe'), false);
  assert.equal(O.readCompass(s), 'denied', 'invalid value does not overwrite');
});

test('readCompass returns null when unset or storage throws', () => {
  assert.equal(O.readCompass(memStorage()), null);
  assert.equal(O.readCompass(throwingStorage()), null);
});

test('compassNeedsPermission is true only where requestPermission exists (iOS 13+)', () => {
  const ios = { DeviceOrientationEvent: { requestPermission: () => Promise.resolve('granted') } };
  assert.equal(O.compassNeedsPermission(ios), true);
  assert.equal(O.compassNeedsPermission({ DeviceOrientationEvent: function () {} }), false, 'Android/desktop');
  assert.equal(O.compassNeedsPermission({}), false, 'no orientation support');
  assert.equal(O.compassNeedsPermission(undefined), false);
});

test('shouldAutoEnableCompass is true only after the compass was granted', () => {
  assert.equal(O.shouldAutoEnableCompass(memStorage({ [O.COMPASS_KEY]: 'granted' })), true);
  assert.equal(O.shouldAutoEnableCompass(memStorage({ [O.COMPASS_KEY]: 'denied' })), false);
  assert.equal(O.shouldAutoEnableCompass(memStorage({ [O.COMPASS_KEY]: 'na' })), false);
  assert.equal(O.shouldAutoEnableCompass(memStorage()), false);
});

test('startTarget sends the visitor to the viewer only once a location is known', () => {
  assert.equal(O.startTarget(memStorage()), null);
  assert.equal(O.startTarget(memStorage({ [O.LOC_KEY]: '{"lat":1,"lon":2}' })), 'viewer.html');
});

test('SAMPLE_LOCATION is the agreed sample coordinate pair and is frozen', () => {
  assert.equal(O.SAMPLE_LOCATION.lat, 17.4435);
  assert.equal(O.SAMPLE_LOCATION.lon, 78.3772);
  assert.ok(Object.isFrozen(O.SAMPLE_LOCATION));
});

test('SAMPLE_LOCATION passes the same validation as typed coordinates', () => {
  const s = memStorage();
  assert.equal(O.storeLocation(s, O.SAMPLE_LOCATION.lat, O.SAMPLE_LOCATION.lon), true);
  assert.deepEqual(O.readLocation(s), { lat: 17.4435, lon: 78.3772 });
  assert.equal(O.startTarget(s), 'viewer.html');
});
