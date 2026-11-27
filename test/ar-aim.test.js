'use strict';
// The crosshair picks the object it is held on, without a tap: the aim maths, and the camera view run against a mocked
// camera with a clock the test controls.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const AR = require('../lib/ar.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

/* ---- which object is the target ---- */
test('the target is the object nearest the middle of the picture, within the aim radius', () => {
  const W = 400, H = 800, items = [{ id: 'far', x: 200 + 60, y: 400 }, { id: 'near', x: 200 + 10, y: 400 - 8 }, { id: 'edge', x: 200, y: 400 + AR.AIM_RADIUS }];
  assert.equal(AR.aimTarget(items, W, H), 'near', 'the nearer of two');
  assert.equal(AR.aimTarget([items[2]], W, H), 'edge', 'exactly on the radius counts');
  assert.equal(AR.aimTarget([{ id: 'x', x: 200, y: 400 + AR.AIM_RADIUS + 1 }], W, H), null, 'just outside does not');
  assert.equal(AR.aimTarget([items[0]], W, H), null, 'an object elsewhere in the picture is not aimed at');
  assert.equal(AR.aimTarget([], W, H), null); assert.equal(AR.aimTarget(null, W, H), null);
});

test('the middle is the middle of this picture, whatever its size, and bad items are skipped', () => {
  assert.equal(AR.aimTarget([{ id: 'a', x: 195, y: 422 }], 390, 844), 'a');
  assert.equal(AR.aimTarget([{ id: 'a', x: 195, y: 422 }], 400, 1000), null, 'the middle of a taller picture is lower down');
  assert.equal(AR.aimTarget([{ id: 'nan', x: NaN, y: 400 }, { id: 'undef' }, null, { id: 'ok', x: 200, y: 400 }], 400, 800), 'ok');
  assert.equal(AR.aimTarget([{ id: 'a', x: 200, y: 400 }, { id: 'b', x: 200, y: 400 }], 400, 800), 'a', 'a tie keeps the first');
});

/* ---- when it is picked ---- */
test('an object is picked only after the crosshair has stayed on it for the whole hold time', () => {
  let r = AR.aimStep(null, 'sat:1', 1000, null);
  assert.equal(r.select, null); assert.equal(r.progress, 0);
  r = AR.aimStep(r.st, 'sat:1', 1000 + AR.AIM_DWELL_MS / 2, null);
  assert.equal(r.select, null); assert.ok(Math.abs(r.progress - 0.5) < 1e-9, 'half way: ' + r.progress);
  r = AR.aimStep(r.st, 'sat:1', 1000 + AR.AIM_DWELL_MS - 1, null);
  assert.equal(r.select, null, 'one millisecond short');
  r = AR.aimStep(r.st, 'sat:1', 1000 + AR.AIM_DWELL_MS, null);
  assert.equal(r.select, 'sat:1'); assert.equal(r.progress, 1);
});

test('it is picked once, not again every frame, and not again until the crosshair has left it', () => {
  let r = AR.aimStep(null, 'a', 0, null); r = AR.aimStep(r.st, 'a', 700, null);
  assert.equal(r.select, 'a');
  for (const t of [716, 733, 2000, 9000]) { r = AR.aimStep(r.st, 'a', t, 'a'); assert.equal(r.select, null, 'frame at ' + t); }
  // the visitor taps something else while still aiming at "a": it is not taken back
  for (const t of [9016, 12000]) { r = AR.aimStep(r.st, 'a', t, 'b'); assert.equal(r.select, null, 'a tap on another object stays: ' + t); }
  // move off, then back on: held again, picked again
  r = AR.aimStep(r.st, null, 12100, 'b');
  r = AR.aimStep(r.st, 'a', 12200, 'b'); assert.equal(r.select, null);
  r = AR.aimStep(r.st, 'a', 12200 + AR.AIM_DWELL_MS, 'b'); assert.equal(r.select, 'a');
});

test('swinging past objects picks nothing: moving to another object, or off every object, starts the hold again', () => {
  let r = AR.aimStep(null, 'a', 0, null);
  r = AR.aimStep(r.st, 'a', 500, null);
  r = AR.aimStep(r.st, 'b', 550, null); assert.equal(r.select, null); assert.equal(r.progress, 0, 'b starts from nothing');
  r = AR.aimStep(r.st, 'b', 550 + 599, null); assert.equal(r.select, null, 'a left 599 ms ago and b has had 599 ms');
  r = AR.aimStep(r.st, null, 1200, null); assert.equal(r.select, null); assert.equal(r.progress, 0);
  r = AR.aimStep(r.st, 'b', 1300, null); r = AR.aimStep(r.st, 'b', 1300 + 599, null); assert.equal(r.select, null, 'the time on b before is not counted');
});

test('an object that is already the pick is not picked again, and a pick made by hand is kept', () => {
  let r = AR.aimStep(null, 'a', 0, 'a'); assert.equal(r.select, null);
  r = AR.aimStep(r.st, 'a', 5000, 'a'); assert.equal(r.select, null);
  r = AR.aimStep(null, 'a', 0, 'z'); r = AR.aimStep(r.st, 'a', 1000, 'z');
  assert.equal(r.select, 'a', 'aiming at another object than the pick does pick it');
});

test('the hold is under a second and the radius is small enough to mean what it points at', () => {
  assert.ok(AR.AIM_DWELL_MS >= 300 && AR.AIM_DWELL_MS <= 1000, 'hold: ' + AR.AIM_DWELL_MS);
  assert.ok(AR.AIM_RADIUS >= 15 && AR.AIM_RADIUS <= 40, 'radius: ' + AR.AIM_RADIUS);
});

/* ---- the camera view, with a clock the test controls ---- */
function viewEnv(objects, { selected = () => null } = {}) {
  let now = 5000, cb = null;
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => ({ width: 10 })), set: (t, k, v) => { t[k] = v; return true; } });
  const canvas = { width: 0, height: 0, clientWidth: 400, clientHeight: 800, getContext: () => ctx, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  const g = {
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } },
    document: { body: { classList: { add() {}, remove() {} } } },
    requestAnimationFrame: (f) => { cb = f; return 1; }, cancelAnimationFrame() {}, performance: { now: () => now }, devicePixelRatio: 1, console,
  };
  g.self = g; g.globalThis = g; vm.createContext(g);
  for (const f of ['lib/logic.js', 'lib/ar.js', 'ar-view.js']) vm.runInContext(read(f), g, { filename: f });
  const picked = [], ori = { alpha: 0, beta: 90, gamma: 0, compassHeading: 0, absolute: true };
  const view = g.FarGemsARView.create({
    root: { hidden: true }, video: { srcObject: null, play: async () => {} }, canvas, closeBtn: { addEventListener() {} },
    getObjects: () => objects, getFilters: () => ({ air: true, sat: true, sky: true, met: true, star: true, labels: true }), getSelected: selected,
    getOrientation: () => ori, onSelect: (id) => picked.push(id), onClose() {},
  });
  // Draw frames at 16 ms steps for `ms` of the clock (the view draws once when opened, then once per animation frame).
  const run = (ms) => { for (let t = 0; t < ms; t += 16) { now += 16; if (cb) cb(); } };
  return { view, picked, run, ori, setAligning: (on) => view.setAligning(on) };
}
const moon = (az, el) => ({ id: 'body:Moon', kind: 'body', name: 'Moon', az, el, color: '#e6ecf5', phase: 0.5 });

test('the camera view picks the object under the crosshair after the hold, once, without a tap', async () => {
  const e = viewEnv([moon(0, 0)]); // facing north, level: the Moon is at the crosshair
  await e.view.open();
  e.run(AR.AIM_DWELL_MS - 100); assert.deepEqual(e.picked, [], 'not yet');
  e.run(300); assert.deepEqual(e.picked, ['body:Moon'], 'held long enough');
  e.run(3000); assert.deepEqual(e.picked, ['body:Moon'], 'not picked again every frame');
});

test('an object that is not at the crosshair is not picked, however long the phone is held', async () => {
  const e = viewEnv([moon(20, 10)]); // 20 degrees to the right and 10 up: well away from the middle
  await e.view.open();
  e.run(4000); assert.deepEqual(e.picked, []);
});

test('turning the phone onto an object picks it, and turning away again keeps it picked', async () => {
  const objs = [moon(40, 0)], e = viewEnv(objs);
  await e.view.open();
  e.run(1500); assert.deepEqual(e.picked, [], 'facing north: nothing at the crosshair');
  e.ori.compassHeading = 40; e.run(300); assert.deepEqual(e.picked, [], 'just arrived');
  e.run(500); assert.deepEqual(e.picked, ['body:Moon']);
  e.ori.compassHeading = 200; e.run(1500); assert.deepEqual(e.picked, ['body:Moon'], 'looking away does not clear the pick');
});

test('a quick sweep across an object picks nothing', async () => {
  const e = viewEnv([moon(40, 0)]);
  await e.view.open();
  for (const h of [30, 35, 40, 45, 50, 60]) { e.ori.compassHeading = h; e.run(100); }
  assert.deepEqual(e.picked, []);
});

test('an object that is already the pick is left alone, and nothing is picked while the picture is lined up by hand', async () => {
  const same = viewEnv([moon(0, 0)], { selected: () => 'body:Moon' });
  await same.view.open(); same.run(2000); assert.deepEqual(same.picked, []);
  const hand = viewEnv([moon(0, 0)]);
  await hand.view.open(); hand.setAligning(true); hand.run(2000);
  assert.deepEqual(hand.picked, [], 'dragging the picture is not choosing');
  hand.setAligning(false); hand.run(1000); assert.deepEqual(hand.picked, ['body:Moon'], 'and it works again afterwards');
});

test('the crosshair shows the hold filling, and the picture draws no aim state before the sensors start', () => {
  const src = read('ar-view.js');
  assert.match(src, /AR\.aimStep\(aimSt, AR\.aimTarget\(items, W, H\), /);
  assert.match(src, /if \(aim\.select\) o\.onSelect\(aim\.select\);/);
  assert.match(src, /if \(aimProgress > 0 && aimProgress < 1\)/, 'a ring fills while holding');
  assert.match(src, /isOpen = true; heading = null; [^\n]*aimSt = \{ id: null, since: 0, done: false \}; aimProgress = 0;/, 'a fresh start each time the view opens');
});
