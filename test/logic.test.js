'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../lib/logic.js');

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg || ''} expected ~${expected}, got ${actual}`);

test('esc escapes all HTML-significant characters', () => {
  assert.equal(L.esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
});

test('esc renders null and undefined as empty strings and numbers as text', () => {
  assert.equal(L.esc(null), '');
  assert.equal(L.esc(undefined), '');
  assert.equal(L.esc(42), '42');
});

test('norm360 wraps angles into [0, 360)', () => {
  assert.equal(L.norm360(-90), 270);
  assert.equal(L.norm360(450), 90);
  assert.equal(L.norm360(360), 0);
  assert.equal(L.norm360(0), 0);
});

test('dir16 names bearings on the 16-point compass', () => {
  assert.equal(L.dir16(0), 'N');
  assert.equal(L.dir16(22.5), 'NNE');
  assert.equal(L.dir16(90), 'E');
  assert.equal(L.dir16(180), 'S');
  assert.equal(L.dir16(270), 'W');
  assert.equal(L.dir16(359), 'N');
  assert.equal(L.dir16(-90), 'W');
});

test('md maps month/day to days since 1 Jan in a leap-free reference year', () => {
  assert.equal(L.md(1, 1), 0);
  assert.equal(L.md(12, 31), 364);
  assert.equal(L.md(3, 1) - L.md(2, 1), 28);
});

const SHOWERS = [
  { n: 'Quadrantids', s: [12, 28], e: [1, 12], p: [1, 3], ra: 230, dec: 49.5, zhr: 80 },
  { n: 'Perseids', s: [7, 17], e: [8, 24], p: [8, 12], ra: 48, dec: 58, zhr: 100 },
  { n: 'Lyrids', s: [4, 14], e: [4, 30], p: [4, 22], ra: 271, dec: 34, zhr: 18 },
];

test('showerView marks a shower active inside its window and not outside', () => {
  const byName = (list, n) => list.find((s) => s.n === n);
  const inside = byName(L.showerView(SHOWERS, new Date(2026, 7, 15)), 'Perseids');
  const outside = byName(L.showerView(SHOWERS, new Date(2026, 1, 1)), 'Perseids');
  assert.equal(inside.active, true);
  assert.equal(outside.active, false);
});

test('showerView reports zero peakDelta on the peak date', () => {
  const p = L.showerView(SHOWERS, new Date(2026, 7, 12)).find((s) => s.n === 'Perseids');
  assert.equal(p.peakDelta, 0);
});

test('showerView handles a window that wraps the new year', () => {
  const dec31 = L.showerView(SHOWERS, new Date(2026, 11, 31)).find((s) => s.n === 'Quadrantids');
  const jan5 = L.showerView(SHOWERS, new Date(2026, 0, 5)).find((s) => s.n === 'Quadrantids');
  const feb1 = L.showerView(SHOWERS, new Date(2026, 1, 1)).find((s) => s.n === 'Quadrantids');
  assert.equal(dec31.active, true);
  assert.equal(jan5.active, true);
  assert.equal(feb1.active, false);
  // Peak was 3 Jan; on 31 Dec that is 3 days in the future, reported as -3 (days ago).
  assert.equal(dec31.peakDelta, -3);
});

test('showerView puts active showers first, then by days until start', () => {
  const list = L.showerView(SHOWERS, new Date(2026, 7, 15));
  assert.equal(list[0].n, 'Perseids');
  let seenInactive = false;
  for (const s of list) {
    if (!s.active) seenInactive = true;
    else assert.equal(seenInactive, false, 'no active shower after an inactive one');
  }
  const inactive = list.filter((s) => !s.active);
  for (let i = 1; i < inactive.length; i++) {
    assert.ok(inactive[i - 1].daysTo <= inactive[i].daysTo);
  }
});

test('showerView does not mutate the input table', () => {
  const copy = JSON.stringify(SHOWERS);
  L.showerView(SHOWERS, new Date(2026, 7, 15));
  assert.equal(JSON.stringify(SHOWERS), copy);
});

test('sunPhase labels each twilight band', () => {
  assert.equal(L.sunPhase(null), '');
  assert.equal(L.sunPhase(10), 'Day');
  assert.equal(L.sunPhase(0), 'Civil twilight');
  assert.equal(L.sunPhase(-5.9), 'Civil twilight');
  assert.equal(L.sunPhase(-6), 'Nautical twilight');
  assert.equal(L.sunPhase(-12), 'Astronomical twilight');
  assert.equal(L.sunPhase(-18), 'Night');
  assert.equal(L.sunPhase(-40), 'Night');
});

test('moonPhaseName maps elongation to the eight phase names', () => {
  assert.equal(L.moonPhaseName(0), 'New Moon');
  assert.equal(L.moonPhaseName(90), 'First quarter');
  assert.equal(L.moonPhaseName(180), 'Full Moon');
  assert.equal(L.moonPhaseName(270), 'Last quarter');
  assert.equal(L.moonPhaseName(300), 'Waning crescent');
  assert.equal(L.moonPhaseName(350), 'New Moon'); // wraps back into the first bucket
});

test('ago formats elapsed time in seconds, minutes, hours and days', () => {
  assert.equal(L.ago(45000), '45s');
  assert.equal(L.ago(10 * 60 * 1000), '10m');
  assert.equal(L.ago(3 * 3600 * 1000), '3h');
  assert.equal(L.ago(3 * 86400 * 1000), '3d');
});

test('mix interpolates RGB triples and rounds', () => {
  assert.deepEqual(L.mix([0, 0, 0], [100, 200, 50], 0.5), [50, 100, 25]);
  assert.deepEqual(L.mix([1, 2, 3], [9, 9, 9], 0), [1, 2, 3]);
  assert.deepEqual(L.mix([1, 2, 3], [9, 9, 9], 1), [9, 9, 9]);
});

test('parseV2 keeps airborne aircraft with IDs and normalises fields', () => {
  const out = L.parseV2({ ac: [
    { hex: 'ABC123', flight: ' BA123 ', lat: 51.5, lon: -0.1, alt_baro: 35000, gs: 450, track: 90, baro_rate: -64, t: 'A320', r: 'G-EUXX' },
  ] });
  assert.equal(out.length, 1);
  const a = out[0];
  assert.equal(a.id, 'abc123');
  assert.equal(a.call, 'BA123');
  assert.equal(a.reg, 'G-EUXX');
  assert.equal(a.type, 'A320');
  assert.equal(a.altFt, 35000);
  assert.equal(a.vr, -64);
});

test('parseV2 drops ground traffic, low altitudes, missing IDs and bad positions', () => {
  const out = L.parseV2({ ac: [
    { hex: 'gnd', lat: 1, lon: 1, alt_baro: 'ground' },
    { hex: 'low', lat: 1, lon: 1, alt_baro: 100 },
    { hex: '', lat: 1, lon: 1, alt_baro: 30000 },
    { hex: 'nopos', lat: 'x', lon: 1, alt_baro: 30000 },
  ] });
  assert.deepEqual(out, []);
});

test('parseV2 falls back to geometric altitude and accepts the "aircraft" key', () => {
  const out = L.parseV2({ aircraft: [{ hex: 'g1', lat: 1, lon: 1, alt_geom: 20000 }] });
  assert.equal(out.length, 1);
  assert.equal(out[0].altFt, 20000);
});

test('parseV2 returns an empty list when the payload has no aircraft', () => {
  assert.deepEqual(L.parseV2({}), []);
});

test('parseOpenSky converts metres and m/s to feet, knots and ft/min', () => {
  const row = ['a1b2c3', 'UAL1  ', 'US', 0, 0, -0.5, 51.4, 10000, false, 200, 270, -5, null, 10100];
  const [a] = L.parseOpenSky({ states: [row] });
  near(a.altFt, 10100 * 3.28084, 0.01, 'altFt uses geometric altitude');
  near(a.gs, 200 * 1.94384, 0.01, 'gs in knots');
  near(a.vr, -5 * 196.85, 0.01, 'vr in ft/min');
  assert.equal(a.call, 'UAL1');
  assert.equal(a.id, 'a1b2c3');
  assert.equal(a.lat, 51.4);
  assert.equal(a.lon, -0.5);
});

test('parseOpenSky drops on-ground, unpositioned and very low aircraft', () => {
  const states = [
    ['g', 'GND', '', 0, 0, 1, 1, 100, true, 5, 0, 0, null, 100],
    ['n', 'NOPOS', '', 0, 0, null, 1, 100, false, 5, 0, 0, null, 100],
    ['l', 'LOW', '', 0, 0, 1, 1, 10, false, 5, 0, 0, null, null],
  ];
  assert.deepEqual(L.parseOpenSky({ states }), []);
  assert.deepEqual(L.parseOpenSky({}), []);
});

test('openSkyUrl builds a bounding box around the point (radius in nm)', () => {
  assert.equal(
    L.openSkyUrl(0, 0, 60),
    'https://opensky-network.org/api/states/all?lamin=-1.000&lomin=-1.000&lamax=1.000&lomax=1.000',
  );
});

test('advance moves an aircraft along its track and changes altitude', () => {
  // 360 kt for one hour is 360 nm; 1 deg latitude is 60 nm.
  const north = L.advance({ lat: 0, lon: 0, gs: 360, track: 0, altFt: 10000, vr: 0 }, 3600);
  near(north.lat, 6, 1e-9, 'lat north');
  near(north.lon, 0, 1e-9, 'lon north');
  near(north.altKm, 10000 * 0.0003048, 1e-9, 'altitude km');

  const east = L.advance({ lat: 0, lon: 0, gs: 360, track: 90, altFt: 10000, vr: 0 }, 3600);
  near(east.lat, 0, 1e-9, 'lat east');
  near(east.lon, 6, 1e-9, 'lon east');
});

test('advance does not move a stationary aircraft and clamps altitude at zero', () => {
  const still = L.advance({ lat: 10, lon: 20, gs: 0, track: 45, altFt: 5000, vr: 0 }, 60);
  assert.equal(still.lat, 10);
  assert.equal(still.lon, 20);
  const landed = L.advance({ lat: 0, lon: 0, gs: 0, track: 0, altFt: 100, vr: -6000 }, 60);
  assert.equal(landed.altKm, 0);
});

test('parseTLE reads 3-line objects, strips the "0 " prefix and extracts NORAD ids', () => {
  const text = [
    '0 ISS (ZARYA)',
    '1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9000',
    '2 25544  51.6400 208.9163 0006317  69.9862  25.2906 15.49560532000000',
    'TIANGONG',
    '1 48274U 21035A   24001.50000000  .00000000  00000-0  00000-0 0  9999',
    '2 48274  41.4700 100.0000 0005000  10.0000  20.0000 15.61000000000000',
  ].join('\r\n');
  const seen = [];
  const sats = L.parseTLE(text, 'visual', (l1, l2) => { seen.push([l1, l2]); return { error: 0, l1 }; });
  assert.equal(sats.length, 2);
  assert.equal(sats[0].name, 'ISS (ZARYA)');
  assert.equal(sats[0].norad, 25544);
  assert.equal(sats[0].group, 'visual');
  assert.equal(sats[1].name, 'TIANGONG');
  assert.equal(sats[1].norad, 48274);
  assert.equal(seen.length, 2);
});

test('parseTLE skips element sets the parser rejects or throws on', () => {
  const text = [
    'BAD ONE',
    '1 00001U 00000A   00001.00000000  .0  0  0  0 0  1',
    '2 00001  1.0 1.0 0 1.0 1.0 1.0000000000001',
    'BAD TWO',
    '1 00002U 00000A   00001.00000000  .0  0  0  0 0  1',
    '2 00002  1.0 1.0 0 1.0 1.0 1.0000000000001',
  ].join('\n');
  let call = 0;
  const sats = L.parseTLE(text, 'x', () => {
    call++;
    if (call === 1) return { error: 1 };
    throw new Error('bad element set');
  });
  assert.deepEqual(sats, []);
  assert.equal(call, 2);
});

test('parseTLE ignores text with no complete object', () => {
  assert.deepEqual(L.parseTLE('', 'x', () => ({})), []);
  assert.deepEqual(L.parseTLE('only one line', 'x', () => ({})), []);
});
