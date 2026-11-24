'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../lib/core.js');

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg || ''} expected ~${expected} got ${actual}`);

test('dirName maps compass bearings to 8 points', () => {
  assert.equal(C.dirName(0), 'N');
  assert.equal(C.dirName(359), 'N');
  assert.equal(C.dirName(90), 'E');
  assert.equal(C.dirName(180), 'S');
  assert.equal(C.dirName(270), 'W');
  assert.equal(C.dirName(225), 'SW');
});

test('dirName normalises negative and out-of-range azimuths', () => {
  assert.equal(C.dirName(-90), 'W');
  assert.equal(C.dirName(450), 'E');
  assert.equal(C.dirName(-360), 'N');
});

test('fmt rounds to given decimals and renders non-finite as en dash', () => {
  assert.equal(C.fmt(3.14159, 2), '3.14');
  assert.equal(C.fmt(7.6), '8');
  assert.equal(C.fmt(NaN), '–');
  assert.equal(C.fmt(Infinity, 1), '–');
  assert.equal(C.fmt(undefined), '–');
});

test('ecef puts the equator/prime meridian point on the x-axis', () => {
  const [x, y, z] = C.ecef(0, 0, 0);
  near(x, 6378137, 0.5, 'x');
  near(y, 0, 1e-6, 'y');
  near(z, 0, 1e-6, 'z');
});

test('ecef places the north pole on the z-axis at the polar radius', () => {
  const [x, y, z] = C.ecef(90, 0, 0);
  near(x, 0, 1e-3, 'x');
  near(y, 0, 1e-3, 'y');
  near(z, 6356752.3, 1, 'z');
});

test('lookAngles: target straight overhead is 90 degrees altitude', () => {
  const r = C.lookAngles(51.5, -0.12, 0, 51.5, -0.12, 1000);
  near(r.alt, 90, 1e-3, 'alt');
  near(r.range, 1, 1e-6, 'range');
});

test('lookAngles: cardinal directions for targets 1 km away at ground level', () => {
  // ~0.009 degrees of latitude is ~1 km; use small offsets at the equator.
  const d = 0.009;
  const north = C.lookAngles(0, 0, 0, d, 0, 0);
  const east = C.lookAngles(0, 0, 0, 0, d, 0);
  const south = C.lookAngles(0, 0, 0, -d, 0, 0);
  const west = C.lookAngles(0, 0, 0, 0, -d, 0);
  near(north.az, 0, 0.01, 'north az');
  near(east.az, 90, 0.01, 'east az');
  near(south.az, 180, 0.01, 'south az');
  near(west.az, 270, 0.01, 'west az');
  for (const r of [north, east, south, west]) {
    near(r.range, 1.0, 0.01, 'range km');
    assert.ok(r.az >= 0 && r.az < 360, 'az normalised to [0,360)');
  }
});

test('lookAngles: horizontal target at the same height is near the horizon', () => {
  const r = C.lookAngles(0, 0, 0, 0, 0.01, 0);
  near(r.alt, 0, 0.05, 'alt');
});

test('lookAngles: a high target on the same bearing has positive altitude', () => {
  const r = C.lookAngles(0, 0, 0, 0, 0.01, 10000);
  assert.ok(r.alt > 0, 'above horizon');
  assert.ok(r.alt < 90);
});

test('lookAngles: targets below the observer have negative altitude', () => {
  const r = C.lookAngles(0, 0, 1000, 0, 0.01, 0);
  assert.ok(r.alt < 0, `expected below horizon, got ${r.alt}`);
});

test('parseTLE reads 3-line objects and skips stray lines', () => {
  const text = [
    'ISS (ZARYA)',
    '1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9000',
    '2 25544  51.6400 208.9163 0006317  69.9862  25.2906 15.49560532000000',
    'garbage line',
    'TIANGONG',
    '1 48274U 21035A   24001.50000000  .00000000  00000-0  00000-0 0  9999',
    '2 48274  41.4700 100.0000 0005000  10.0000  20.0000 15.61000000000000',
  ].join('\r\n');
  const sats = C.parseTLE(text);
  assert.equal(sats.length, 2);
  assert.equal(sats[0].name, 'ISS (ZARYA)');
  assert.ok(sats[0].l1.startsWith('1 25544'));
  assert.ok(sats[0].l2.startsWith('2 25544'));
  assert.equal(sats[1].name, 'TIANGONG');
});

test('parseTLE returns an empty list for empty or malformed input', () => {
  assert.deepEqual(C.parseTLE(''), []);
  assert.deepEqual(C.parseTLE('just some text\nmore text\n'), []);
  assert.deepEqual(C.parseTLE(undefined), []);
});

test('catalogNumber extracts the NORAD id from TLE line 1', () => {
  assert.equal(C.catalogNumber('1 25544U 98067A   24001.50000000'), '25544');
  assert.equal(C.catalogNumber('1 48274U 21035A   24001.50000000'), '48274');
});

test('daysToPeak counts forward to the next occurrence within the year', () => {
  const now = Date.UTC(2026, 10, 24); // 24 Nov 2026
  assert.equal(C.daysToPeak(12, 14, new Date(now)), 20); // Geminids
  assert.equal(C.daysToPeak(12, 22, new Date(now)), 28); // Ursids
  assert.equal(C.daysToPeak(1, 4, new Date(now)), 41);   // Quadrantids next year
});

test('daysToPeak returns a negative value for a peak passed within 180 days', () => {
  const now = Date.UTC(2026, 10, 24);
  // Perseids peaked 12 Aug 2026, about 104 days earlier.
  assert.equal(C.daysToPeak(8, 12, new Date(now)), -104);
});

test('daysToPeak rolls to next year once a peak is more than 180 days past', () => {
  const now = Date.UTC(2026, 10, 24);
  // Lyrids peaked 22 Apr 2026, about 216 days earlier, so the next peak is 22 Apr 2027.
  assert.equal(C.daysToPeak(4, 22, new Date(now)), 149);
});

test('STARS table has sane coordinates and unique names', () => {
  assert.ok(C.STARS.length >= 15);
  const names = new Set();
  for (const [name, ra, dec, mag] of C.STARS) {
    assert.ok(typeof name === 'string' && name.length > 0);
    assert.ok(!names.has(name), `duplicate ${name}`);
    names.add(name);
    assert.ok(ra >= 0 && ra < 24, `${name} RA hours`);
    assert.ok(dec >= -90 && dec <= 90, `${name} Dec`);
    assert.ok(Number.isFinite(mag), `${name} mag`);
  }
});

test('SHOWERS table has valid dates, radiants and rates', () => {
  assert.equal(C.SHOWERS.length, 8);
  for (const s of C.SHOWERS) {
    assert.ok(s.m >= 1 && s.m <= 12, `${s.name} month`);
    assert.ok(s.d >= 1 && s.d <= 31, `${s.name} day`);
    assert.ok(s.ra >= 0 && s.ra < 24, `${s.name} RA`);
    assert.ok(s.dec >= -90 && s.dec <= 90, `${s.name} Dec`);
    assert.ok(s.zhr > 0, `${s.name} ZHR`);
    assert.ok(Number.isFinite(C.daysToPeak(s.m, s.d, new Date())), `${s.name} date`);
  }
});

test('TLE_URLS are all HTTPS CelesTrak endpoints', () => {
  assert.equal(C.TLE_URLS.length, 3);
  for (const u of C.TLE_URLS) {
    assert.ok(u.startsWith('https://celestrak.org/'), u);
  }
});
