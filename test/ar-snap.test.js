'use strict';
// One-tap line-up: aim the cross at the real Sun, Moon or a bright planet and the difference becomes the correction.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const AR = require('../lib/ar.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const sun = (az, el) => ({ id: 'body:Sun', kind: 'body', name: 'Sun', az, el, mag: null });
const planet = (name, az, el, mag) => ({ id: 'body:' + name, kind: 'body', name, az, el, mag });

test('the target is the nearest visible Sun, Moon or bright planet to where the phone points', () => {
  const cam = { heading: 100, pitch: 20 };
  assert.equal(AR.snapTarget([sun(110, 25), planet('Venus', 160, 20, -4)], cam).name, 'Sun');
  assert.equal(AR.snapTarget([sun(130, 25), planet('Venus', 104, 22, -4)], cam).name, 'Venus', 'the nearer one wins');
  assert.equal(AR.snapTarget([sun(100, -5)], cam), null, 'below the horizon is not in the sky');
  assert.equal(AR.snapTarget([planet('Neptune', 101, 20, 7.8)], cam), null, 'too faint to see');
  assert.equal(AR.snapTarget([sun(200, 20)], cam), null, 'too far from where the phone points');
  assert.equal(AR.snapTarget([{ id: 'air:1', kind: 'air', az: 100, el: 20 }], cam), null, 'planes are not a target');
  assert.equal(AR.snapTarget(null, cam), null);
});

test('the correction is the difference, added to what was already there', () => {
  // The camera says 100 and 20 up; the Sun really is at 108 and 23.
  assert.deepEqual(AR.snapOffset({ h: 0, p: 0 }, { heading: 100, pitch: 20 }, sun(108, 23)), { h: 8, p: 3 });
  assert.deepEqual(AR.snapOffset({ h: 2, p: -1 }, { heading: 100, pitch: 20 }, sun(95, 20)), { h: -3, p: -1 });
  assert.deepEqual(AR.snapOffset(null, { heading: 359, pitch: 0 }, sun(3, 0)), { h: 4, p: 0 }, 'across north');
  assert.equal(AR.snapOffset({ h: 40, p: 0 }, { heading: 0, pitch: 0 }, sun(20, 0)), null, 'more than a correction can cover');
});

/* ---- the camera view ---- */
function viewEnv(objects, ori) {
  let off = { h: 0, p: 0 }, cb = null, now = 5000;
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => ({ width: 10 })), set: (t, k, v) => { t[k] = v; return true; } });
  const canvas = { width: 0, height: 0, clientWidth: 400, clientHeight: 800, getContext: () => ctx, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  const g = { navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } }, document: { body: { classList: { add() {}, remove() {} } } }, requestAnimationFrame: (f) => { cb = f; return 1; }, cancelAnimationFrame() {}, performance: { now: () => now }, devicePixelRatio: 1, console };
  g.self = g; g.globalThis = g; vm.createContext(g);
  for (const f of ['lib/logic.js', 'lib/ar.js', 'ar-view.js']) vm.runInContext(read(f), g, { filename: f });
  const view = g.FarGemsARView.create({
    root: { hidden: true }, video: { srcObject: null, play: async () => {} }, canvas, closeBtn: { addEventListener() {} },
    getObjects: () => objects, getFilters: () => ({ air: true, sat: true, sky: true, met: true, star: true, labels: true }), getSelected: () => null,
    getOrientation: () => ori, onSelect() {}, onClose() {}, getOffset: () => off, onOffset: (o) => { off = o; },
  });
  return { view, off: () => off, run: (ms) => { for (let t = 0; t < ms; t += 16) { now += 16; if (cb) cb(); } } };
}

test('snap in the camera view sets the correction from the Sun and keeps it', async () => {
  const e = viewEnv([sun(106, 6)], { alpha: 0, beta: 90, gamma: 0, compassHeading: 100, absolute: true });
  await e.view.open(); e.run(3000);
  const r = e.view.snap();
  assert.equal(r.ok, true); assert.equal(r.name, 'Sun');
  assert.ok(Math.abs(e.off().h - 6) < 0.6, 'heading corrected by about 6: ' + JSON.stringify(e.off()));
  assert.ok(Math.abs(e.off().p - 6) < 0.6, 'pitch corrected by about 6: ' + JSON.stringify(e.off()));
  e.run(3000);
  assert.equal(e.view.snap().ok, true, 'a second snap on the same spot changes nothing more');
  assert.ok(Math.abs(e.off().h - 6) < 0.6);
});

test('snap says why it could not: nothing to aim at, or too far to correct', async () => {
  const none = viewEnv([sun(250, 40)], { alpha: 0, beta: 90, gamma: 0, compassHeading: 100, absolute: true });
  assert.deepEqual({ ...none.view.snap() }, { ok: false, why: 'none' }, 'before the view has drawn');
  await none.view.open(); none.run(1000);
  assert.deepEqual({ ...none.view.snap() }, { ok: false, why: 'none' });
});

test('the line-up bar offers Snap, with a warning about looking at the Sun, and the button is wired to the view', () => {
  const html = read('viewer.html'), app = read('app.js');
  assert.match(html, /<button id="arAlignSnap" class="btn primary" type="button">Snap<\/button>/);
  assert.match(html, /Never stare at the Sun through the camera/);
  assert.match(app, /\$\('#arAlignSnap'\)\.onclick = \(\) => \{\s*const r = arView\.snap\(\);/);
});
