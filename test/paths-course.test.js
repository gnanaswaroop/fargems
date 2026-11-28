'use strict';
// A flight's direction, so it is never drawn flying sideways, and the path of the selected object.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../lib/logic.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const diff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

test('parseV2 keeps a missing speed or direction missing, finds the direction under other names, and keeps the age of the position', () => {
  const [a, b, c, d] = L.parseV2({ ac: [
    { hex: 'a1', lat: 1, lon: 1, alt_baro: 20000 },
    { hex: 'a2', lat: 1, lon: 1, alt_baro: 20000, gs: 300, true_heading: 123, seen_pos: 2.5 },
    { hex: 'a3', lat: 1, lon: 1, alt_baro: 20000, gs: 300, mag_heading: 77 },
    { hex: 'a4', lat: 1, lon: 1, alt_baro: 20000, gs: 300, track: 0 },
  ] });
  assert.equal(a.track, null, 'no direction is not "north"');
  assert.equal(a.gs, null, 'no speed is not "stopped"');
  assert.equal(a.ageS, 0);
  assert.equal(b.track, 123); assert.equal(b.ageS, 2.5);
  assert.equal(c.track, 77);
  assert.equal(d.track, 0, 'a real heading of 0 is kept');
});

test('parseOpenSky keeps a missing speed or direction missing, and the age of the position', () => {
  const row = (extra) => ['a1b2c3', 'UAL1', 'US', 1000, 1000, -0.5, 51.4, 10000, false, ...extra];
  const [a] = L.parseOpenSky({ time: 1004, states: [row([null, null, 0, null, 10100])] });
  assert.equal(a.gs, null); assert.equal(a.track, null); assert.equal(a.ageS, 4);
  const [b] = L.parseOpenSky({ states: [row([200, 270, 0, null, 10100])] });
  assert.equal(b.track, 270); assert.equal(b.ageS, 0);
});

test('hasCourse: a plane is drawn as a plane only when its direction and speed are known', () => {
  assert.equal(L.hasCourse({ track: 90, gs: 400 }), true);
  assert.equal(L.hasCourse({ track: 0, gs: 120 }), true, 'north is a direction');
  assert.equal(L.hasCourse({ track: null, gs: 400 }), false);
  assert.equal(L.hasCourse({ track: 90, gs: null }), false);
  assert.equal(L.hasCourse({ track: 90, gs: 5 }), false, 'hardly moving: no arrow');
  assert.equal(L.hasCourse(null), false);
});

test('reconcileCourse takes a missing direction and speed from the way the flight moved, and corrects a wrong direction', () => {
  const prev = { lat: 17.40, lon: 78.30 };
  // 2 nm due east in 30 s: 240 kt, heading 90.
  const east = { lat: 17.40, lon: 78.30 + 2 / 60 / Math.cos(17.4 * Math.PI / 180) };
  let r = L.reconcileCourse(prev, { ...east, track: null, gs: null }, 30);
  assert.ok(diff(r.track, 90) < 1, 'direction from the movement: ' + r.track);
  assert.ok(Math.abs(r.gs - 240) < 3, 'speed from the movement: ' + r.gs);
  r = L.reconcileCourse(prev, { ...east, track: 85, gs: 250 }, 30);
  assert.deepEqual(r, { track: 85, gs: 250 }, 'a reported direction that agrees is kept');
  r = L.reconcileCourse(prev, { ...east, track: 0, gs: 250 }, 30);
  assert.ok(diff(r.track, 90) < 1, 'a direction far from the movement (north, when it moved east) is replaced: ' + r.track);
  assert.equal(r.gs, 250, 'the speed is kept');
  // Hardly moved, or too soon after: nothing to go by.
  assert.deepEqual(L.reconcileCourse(prev, { lat: 17.40, lon: 78.3001, track: null, gs: null }, 30), { track: null, gs: null });
  assert.deepEqual(L.reconcileCourse(prev, { ...east, track: null, gs: null }, 2), { track: null, gs: null });
  assert.deepEqual(L.reconcileCourse(null, { ...east, track: 10, gs: 300 }, 30), { track: 10, gs: 300 }, 'a flight seen for the first time');
  // A small disagreement over a short move is not enough to override the report.
  const short = { lat: 17.40, lon: 78.30 + 0.5 / 60 };
  assert.equal(L.reconcileCourse(prev, { ...short, track: 40, gs: 250 }, 30).track, 40, 'half a mile is too little to overrule the report');
});

test('a new poll slides the drawn flight to its real place instead of jumping', () => {
  const pos = { lat: 17.5, lon: 78.4, altKm: 3 };
  const corr = { dLat: 0.01, dLon: -0.02, at: 1000 };
  assert.deepEqual(L.applyCorrection(pos, null, 5000), pos);
  const start = L.applyCorrection(pos, corr, 1000), mid = L.applyCorrection(pos, corr, 11000), end = L.applyCorrection(pos, corr, 21000);
  assert.ok(Math.abs(start.lat - 17.51) < 1e-9 && Math.abs(start.lon - 78.38) < 1e-9, 'starts where it had been drawn');
  assert.ok(Math.abs(mid.lat - 17.505) < 1e-9, 'half way after half the time');
  assert.deepEqual(end, pos, 'arrives at the real place');
  assert.equal(start.altKm, 3);
  assert.deepEqual(L.applyCorrection(pos, corr, 99999), pos);
});

test('samplePath follows an object while it is up, marks the hours, and stops where it sets', () => {
  // Rises at 1 hour, sets after 5 hours.
  const up = (s) => ({ az: 90 + s / 100, el: s < 3600 ? -10 : s < 18000 ? 30 : -10 });
  const pts = L.samplePath(up, { stepS: 900, maxS: 43200, minEl: 0 });
  assert.equal(pts[0].s, 3600, 'starts when it comes up');
  assert.equal(pts[pts.length - 1].s, 17100, 'ends before it sets');
  assert.deepEqual(pts.filter((p) => p.hr).map((p) => p.hr), [1, 2, 3, 4], 'a mark on each whole hour from now (the very start, at 0, has none)');
  assert.equal(L.samplePath((s) => ({ az: 5, el: 10 }), { stepS: 900, maxS: 3600 })[0].hr, undefined, 'no mark at the start');
  const now = L.samplePath((s) => ({ az: 10, el: 20 - s / 100 }), { stepS: 60, maxS: 3600, minEl: 0, skipLeading: false });
  assert.equal(now[0].s, 0); assert.ok(now[now.length - 1].el >= 0 && now.length < 40, 'stops when it goes below the horizon');
  assert.deepEqual(L.samplePath(() => null, { stepS: 60, maxS: 600 }), []);
  assert.deepEqual(L.samplePath(() => ({ az: NaN, el: 5 }), { stepS: 60, maxS: 600 }), []);
  assert.ok(L.samplePath((s) => ({ az: 400, el: 5 }), { stepS: 60, maxS: 120 })[0].az === 40, 'azimuth is kept within 0 to 360');
  assert.equal(L.samplePath(() => ({ az: 0, el: -20 }), { stepS: 60, maxS: 600, skipLeading: false }).length, 0, 'never above the horizon: no path');
});

test('an object that does not move across the sky has no path (geostationary)', () => {
  const geo = L.samplePath((s) => ({ az: 180 + s * 1e-5, el: 45 }), { stepS: 30, maxS: 2400, minEl: 0, skipLeading: false });
  assert.ok(geo.length > 50);
  assert.ok(L.pathSpanDeg(geo) < 0.5);
  assert.equal(L.isMoving(geo, 2), false);
  // A low orbit sweeps tens of degrees in a few minutes.
  const leo = L.samplePath((s) => ({ az: 200 - s * 0.2, el: 60 - s * 0.1 }), { stepS: 30, maxS: 600, minEl: 0, skipLeading: false });
  assert.ok(L.pathSpanDeg(leo) > 20);
  assert.equal(L.isMoving(leo, 2), true);
  assert.equal(L.pathSpanDeg([]), 0); assert.equal(L.pathSpanDeg(null), 0);
  assert.ok(Math.abs(L.pathSpanDeg([{ az: 0, el: 0 }, { az: 90, el: 0 }]) - 90) < 1e-6, 'a quarter of the horizon is 90 degrees');
  assert.ok(Math.abs(L.pathSpanDeg([{ az: 0, el: 0 }, { az: 0, el: 90 }]) - 90) < 1e-6);
});

test('the app settles each flight\'s course at every poll, draws a plain dot when it is not known, and draws the path of the selected object', () => {
  const app = read('app.js'), ar = read('ar-view.js');
  assert.match(app, /settleCourses\(list, state\.aircraft, state\.aircraftAt, Date\.now\(\)\);/);
  assert.match(app, /a\.track = r\.track; a\.gs = r\.gs;/);
  assert.match(app, /H0\.applyCorrection\(advance\(a, dt \+ age\), a\.corr, now\.getTime\(\)\)/, 'the position uses its age and the sliding correction');
  assert.match(app, /advance\(a, dt \+ age \+ 15\)/, 'the direction of the arrow comes from the course, not from the correction');
  assert.match(app, /course: H\.hasCourse\(a\)/);
  assert.match(app, /if \(o\.course === false\) \{[^}]*ctx\.arc\(p\.x, p\.y/, 'a plain dot in the radar');
  assert.match(ar, /if \(air && ob\.course === false\)/, 'and in the camera view');
  assert.match(app, /function pathFor\(o\)/);
  for (const bit of ['stepS: 15, maxS: 900', 'stepS: 30, maxS: 2400', 'H.isMoving(pts, 2)', 'stepS: 900, maxS: 43200', "o.kind === 'star'", "o.kind === 'met' && o.shower", "o.kind === 'body'"]) assert.ok(app.includes(bit), bit);
  assert.match(app, /const selObj = \(state\.sel \|\| state\.shownId\) && state\.byId\.get\(state\.sel \|\| state\.shownId\), selPath = selObj && pathFor\(selObj\);/);
  assert.match(app, /haloText\('\+' \+ q\.hr \+ 'h'/, 'hour marks on the radar');
  assert.match(ar, /const path = o\.getPath && o\.getPath\(\);/);
  assert.match(app, /getPath: \(\) => \{ const so = state\.sel && state\.byId\.get\(state\.sel\), pts = so && pathFor\(so\);/);
});
