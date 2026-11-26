'use strict';
// Magnetic declination: phone compasses read magnetic north, the sky is laid out from true north.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const D = require('../lib/declination.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const at = (year) => { // a Date for a decimal year
  const y = Math.floor(year), s = Date.UTC(y, 0, 1), e = Date.UTC(y + 1, 0, 1);
  return new Date(s + (year - y) * (e - s));
};

// NOAA's published WMM2025 test values (declination in degrees): [year, height km, lat, lon, expected D].
const NOAA = [
  [2025, 0, 80, 0, 1.28], [2025, 0, 0, 120, -0.16], [2025, 0, -80, 240, 68.78],
  [2025, 100, 80, 0, 0.85], [2025, 100, 0, 120, -0.15], [2025, 100, -80, 240, 68.21],
  [2027.5, 0, 80, 0, 2.59], [2027.5, 0, 0, 120, -0.24], [2027.5, 0, -80, 240, 68.49],
  [2027.5, 100, 80, 0, 2.16], [2027.5, 100, 0, 120, -0.23], [2027.5, 100, -80, 240, 67.93],
];

test('declination matches the official NOAA WMM2025 test values', () => {
  for (const [year, h, lat, lon, want] of NOAA) {
    const got = D.declination(lat, lon, at(year), h);
    assert.ok(Math.abs(got - want) < 0.03, `${year} h=${h} lat=${lat} lon=${lon}: got ${got.toFixed(3)}, want ${want}`);
  }
});

test('declination at well-known places has the right sign and size', () => {
  const when = new Date('2026-11-25T00:00:00Z');
  const seattle = D.declination(47.6, -122.3, when), london = D.declination(51.5, -0.1, when);
  const hyderabad = D.declination(17.4, 78.5, when), sydney = D.declination(-33.9, 151.2, when);
  assert.ok(seattle > 13 && seattle < 18, `Seattle ${seattle}`);      // magnetic north is east of true north
  assert.ok(london > -2 && london < 4, `London ${london}`);
  assert.ok(hyderabad > -2 && hyderabad < 3, `Hyderabad ${hyderabad}`);
  assert.ok(sydney > 10 && sydney < 14, `Sydney ${sydney}`);
  assert.ok(D.declination(40.7, -74.0, when) < -10, 'New York: magnetic north is west of true north');
});

test('bad input gives 0, so the compass is never made worse', () => {
  assert.equal(D.declination(NaN, 10), 0);
  assert.equal(D.declination(10, undefined), 0);
  assert.equal(D.declination(95, 10), 0);
  assert.equal(D.declination(10, 10, new Date('nope')), 0);
  assert.ok(Number.isFinite(D.declination(90, 0)), 'the pole does not blow up');
  assert.ok(Number.isFinite(D.declination(-90, 0)));
});

test('trueHeading adds the declination and wraps round the circle', () => {
  assert.equal(D.trueHeading(10, 15), 25);
  assert.equal(D.trueHeading(350, 15), 5);
  assert.equal(D.trueHeading(5, -15), 350);
  assert.equal(D.trueHeading(90, NaN), 90);
  assert.equal(D.trueHeading(0, 0), 0);
});

test('the app turns every compass reading into a true heading, in the radar and in the camera view', () => {
  const app = read('app.js'), ar = read('ar-view.js');
  assert.match(app, /FarGemsDeclination\.declination\(lat, lon, new Date\(\)\)/, 'worked out when the location is set');
  assert.match(app, /state\.declination = state\.ori\.declination/);
  assert.match(app, /h = window\.FarGemsDeclination\.trueHeading\(h, state\.declination \+ state\.arOffset\.h\)/);
  assert.match(ar, /ori\.declination/);
  const html = read('viewer.html');
  assert.ok(html.indexOf('lib/declination.js') > -1 && html.indexOf('lib/declination.js') < html.indexOf('src="app.js"'), 'loaded before app.js');
  assert.match(read('sw.js'), /'lib\/declination\.js'/, 'available offline');
});

test('a magnetic heading of 0 in Seattle is 15 degrees east of true north in the map', () => {
  const decl = D.declination(47.6, -122.3, new Date('2026-11-25T00:00:00Z'));
  const t = D.trueHeading(0, decl);
  assert.ok(t > 13 && t < 18, `true heading ${t}`);
});
