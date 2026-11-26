'use strict';
// The Moon drawn as it looks tonight, a picture of the camera view with the labels on it, and a hand adjustment for a
// compass that is a few degrees off.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const AR = require('../lib/ar.js');
const M = require('../lib/moon.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

/* ---- the Moon's shape ---- */
test('the edge between light and dark moves from the lit rim (new) through the middle (half) to the far side (full)', () => {
  assert.equal(M.terminator(0), 1);
  assert.equal(M.terminator(0.5), 0);
  assert.equal(M.terminator(1), -1);
  assert.equal(M.terminator(-3), 1, 'out of range is held to new');
  assert.equal(M.terminator(7), -1, 'out of range is held to full');
  assert.equal(M.terminator(NaN), 1);
});

function recorder() {
  const calls = [];
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { calls.push([k, ...a]); }), set: (t, k, v) => { t[k] = v; calls.push(['set ' + k, v]); return true; } });
  return { ctx, calls };
}

test('a crescent bows its edge toward the Sun, a gibbous Moon bows it away, and a half Moon has a straight edge', () => {
  const edge = (k) => { const r = recorder(); M.litPath(r.ctx, 10, k); return r.calls.filter((c) => c[0] === 'ellipse')[0]; };
  const crescent = edge(0.2), gibbous = edge(0.8), half = edge(0.5);
  assert.equal(crescent[3].toFixed(1), '6.0', 'crescent: the edge is 6 px from the middle, a thin lit rim');
  assert.equal(crescent[8], true, 'crescent: drawn back toward the lit side');
  assert.equal(gibbous[3].toFixed(1), '6.0');
  assert.equal(gibbous[8], false, 'gibbous: drawn round the far side');
  assert.ok(half[3] < 0.01, 'half: no bow at all');
});

test('draw paints the dark disc first, then the lit part with the seas inside it, turned to the Sun', () => {
  const r = recorder();
  M.draw(r.ctx, 50, 60, 16, 0.3, Math.PI / 4, 0.1);
  const names = r.calls.map((c) => c[0]);
  assert.equal(r.calls[0][0], 'save');
  assert.deepEqual(r.calls.find((c) => c[0] === 'translate').slice(1), [50, 60]);
  assert.ok(names.indexOf('translate') < names.indexOf('clip'), 'moved to the Moon before drawing');
  assert.ok(names.indexOf('clip') < names.lastIndexOf('arc'), 'the seas are drawn inside the lit part');
  const rot = r.calls.filter((c) => c[0] === 'rotate').map((c) => c[1]);
  assert.equal(rot[0], Math.PI / 4, 'the lit side points at the Sun');
  assert.ok(Math.abs(rot[0] + rot[1] - 0.1) < 1e-9, 'then the seas are turned by the tilt only');
  assert.equal(M.MARIA.length, 8);
  assert.ok(M.MARIA.every(([x, y, rad]) => Math.hypot(x, y) + rad <= 1.001), 'every sea sits inside the disc');
  const bad = recorder();
  assert.doesNotThrow(() => M.draw(bad.ctx, 0, 0, 10, NaN, NaN, NaN));
});

/* ---- where the Sun is, seen from the Moon, on the picture ---- */
test('the lit side points at the Sun in the camera picture', () => {
  const pose = { heading: 90, pitch: 0 };
  const moon = { az: 90, el: 0 };
  const near = (a, b) => assert.ok(Math.abs(a - b) < 0.05, a + ' vs ' + b);
  near(AR.directionOnScreen(moon, { az: 100, el: 0 }, pose), 0);                // Sun to the right
  near(Math.abs(AR.directionOnScreen(moon, { az: 80, el: 0 }, pose)), Math.PI);  // Sun to the left
  near(Math.abs(AR.directionOnScreen(moon, { az: 90, el: 30 }, pose)), Math.PI / 2); // Sun above
  assert.ok(AR.directionOnScreen(moon, { az: 90, el: 30 }, pose) < 0, 'above is up the screen, which is negative y');
  near(AR.directionOnScreen(moon, { az: 90, el: -30 }, pose), Math.PI / 2);   // Sun below
  assert.ok(Math.abs(AR.directionOnScreen({ az: 270, el: 20 }, { az: 90, el: 10 }, pose)) <= Math.PI, 'a Sun on the far side still gives an angle');
});

test('parallacticAngle is zero on the meridian, and opposite in the east and the west', () => {
  assert.ok(Math.abs(AR.parallacticAngle(180, 50, 17.4)) < 1e-9);
  assert.ok(AR.parallacticAngle(90, 30, 17.4) > 40);
  assert.ok(AR.parallacticAngle(270, 30, 17.4) < -40);
  assert.ok(Math.abs(AR.parallacticAngle(90, 30, 17.4) + AR.parallacticAngle(270, 30, 17.4)) < 1e-9, 'mirror images');
});

/* ---- the picture ---- */
test('coverCrop is the part of the video that fills the screen', () => {
  const k = AR.coverCrop(1920, 1080, 390, 800);
  assert.equal(k.sy, 0); assert.equal(k.sh, 1080, 'a tall screen shows the full height of a wide video');
  assert.ok(Math.abs(k.sw / k.sh - 390 / 800) < 1e-9, 'same shape as the screen');
  assert.ok(Math.abs(k.sx - (1920 - k.sw) / 2) < 1e-9, 'centred');
  const w = AR.coverCrop(1080, 1920, 800, 390);
  assert.equal(w.sx, 0); assert.ok(Math.abs(w.sw / w.sh - 800 / 390) < 1e-9);
});

function arEnv({ withMoon = true } = {}) {
  const drawn = [], offs = [], listeners = {};
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { drawn.push([k, ...a]); return { width: 10 }; }), set: (t, k, v) => { t[k] = v; return true; } });
  const canvas = { width: 0, height: 0, clientWidth: 400, clientHeight: 800, getContext: () => ctx, addEventListener: (n, f) => { listeners[n] = f; }, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  const made = [];
  const g = {
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } },
    document: {
      body: { classList: { add() {}, remove() {} } },
      createElement: () => { const c = { width: 0, height: 0, calls: [], getContext: () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { c.calls.push([k, ...a]); return { width: 10 }; }), set: (t, k, v) => { t[k] = v; return true; } }), toBlob: (cb, type) => cb({ type, size: 1 }) }; made.push(c); return c; },
    },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}, devicePixelRatio: 2, console,
  };
  g.self = g; g.globalThis = g;
  vm.createContext(g);
  for (const f of ['lib/logic.js', 'lib/ar.js', ...(withMoon ? ['lib/moon.js'] : []), 'ar-view.js']) vm.runInContext(read(f), g, { filename: f });
  let offset = { h: 0, p: 0 };
  const video = { srcObject: null, play: async () => {}, videoWidth: 1920, videoHeight: 1080 };
  const view = g.FarGemsARView.create({
    root: { hidden: true }, video, canvas, closeBtn: { addEventListener() {} },
    getObjects: () => [], getFilters: () => ({ air: true, sat: true, sky: true, labels: true }), getSelected: () => null,
    getOrientation: () => ({ alpha: 0, beta: 90, gamma: 0, absolute: true }), onSelect() {},
    getOffset: () => offset, onOffset: (o) => { offset = o; offs.push(o); }, getLatitude: () => 17.4435,
  });
  return { view, canvas, listeners, made, offs, drawn, getOffset: () => offset };
}

test('capture makes a PNG of the camera picture with the overlay and a caption on it', async () => {
  const e = arEnv();
  await e.view.open();
  e.canvas.width = 800; e.canvas.height = 1600;
  const blob = await e.view.capture();
  assert.equal(blob.type, 'image/png');
  const out = e.made[0];
  assert.deepEqual([out.width, out.height], [800, 1600], 'the picture is as big as the screen');
  const names = out.calls.map((c) => c[0]);
  assert.ok(names.indexOf('drawImage') < names.lastIndexOf('drawImage'), 'the camera picture first, then the overlay');
  const video = out.calls.find((c) => c[0] === 'drawImage');
  assert.equal(video.length, 10, 'the video is cropped to fill the picture like on screen');
  assert.ok(out.calls.some((c) => c[0] === 'fillText' && /^FarGems · /.test(c[1])), 'a small caption');
  assert.ok(!out.calls.some((c) => c[0] === 'fillText' && /\d+\.\d{3}/.test(c[1])), 'no coordinates in the caption');
});

test('capture with no camera picture yet still gives an image (black behind the overlay)', async () => {
  const e = arEnv();
  e.canvas.width = 100; e.canvas.height = 200;
  const blob = await e.view.capture();
  assert.equal(blob.type, 'image/png');
});

test('in line-up mode dragging moves the overlay with the finger, and a tap chooses nothing', async () => {
  const e = arEnv();
  await e.view.open();
  e.view.setAligning(true);
  assert.equal(e.view.isAligning(), true);
  e.listeners.pointerdown({ clientX: 100, clientY: 100 });
  e.listeners.pointermove({ clientX: 200, clientY: 100 });
  assert.equal(e.offs.length, 1);
  assert.ok(e.offs[0].h < -1 && e.offs[0].h > -20, 'dragging right turns the heading down so objects move right: ' + e.offs[0].h);
  assert.equal(e.offs[0].p, 0);
  e.listeners.pointermove({ clientX: 200, clientY: 150 });
  assert.ok(e.offs[1].p > 0, 'dragging down raises the pitch so objects move down');
  e.listeners.pointerup({ clientX: 200, clientY: 150 });
  e.listeners.pointermove({ clientX: 300, clientY: 150 });
  assert.equal(e.offs.length, 2, 'after letting go, moving does nothing');
  e.view.setAligning(false);
  e.listeners.pointerdown({ clientX: 0, clientY: 0 });
  e.listeners.pointermove({ clientX: 50, clientY: 0 });
  assert.equal(e.offs.length, 2, 'outside line-up mode nothing moves');
});

test('closing the camera view ends line-up mode', async () => {
  const e = arEnv();
  await e.view.open();
  e.view.setAligning(true);
  e.view.close();
  assert.equal(e.view.isAligning(), false);
});

/* ---- the hand adjustment ---- */
test('the adjustment is kept within a sensible range, and rubbish means none', () => {
  assert.deepEqual(AR.clampOffset({ h: 100, p: -100 }), { h: 45, p: -25 });
  assert.deepEqual(AR.clampOffset({ h: 'x' }), { h: 0, p: 0 });
  assert.deepEqual(AR.clampOffset(null), { h: 0, p: 0 });
  assert.deepEqual(AR.parseOffset('{"h":-12.5,"p":3}'), { h: -12.5, p: 3 });
  assert.deepEqual(AR.parseOffset('nonsense'), { h: 0, p: 0 });
  assert.deepEqual(AR.parseOffset(null), { h: 0, p: 0 });
  const d = AR.dragOffset({ h: 0, p: 0 }, 100, -50, 1000);
  assert.ok(Math.abs(d.h + 5.7296) < 1e-3 && Math.abs(d.p + 2.8648) < 1e-3);
  assert.deepEqual(AR.dragOffset({ h: 1, p: 2 }, 5, 5, 0), { h: 1, p: 2 }, 'no focal length: unchanged');
  assert.ok(Math.abs(AR.focalFor(1000, 63) - 500 / Math.tan(31.5 * Math.PI / 180)) < 1e-6);
});

/* ---- the page ---- */
test('the page has the Photo and Align buttons, loads the Moon drawing, and keeps it offline', () => {
  const v = read('viewer.html'), app = read('app.js'), sw = read('sw.js');
  assert.match(v, /<button id="arShot" class="btn ar-tool" type="button" aria-label="[^"]+">Photo<\/button>/);
  assert.match(v, /<button id="arAlign" class="btn ar-tool" type="button" aria-pressed="false" aria-label="[^"]+">Align<\/button>/);
  assert.match(v, /id="arAlignBar"[^>]*hidden/);
  assert.ok(v.indexOf('lib/ar.js') < v.indexOf('lib/moon.js') && v.indexOf('lib/moon.js') < v.indexOf('src="app.js"'), 'moon.js loads before the app');
  assert.match(sw, /'lib\/moon\.js'/);
  assert.match(app, /navigator\.share\(\{ files: \[file\]/, 'a picture is shared as a file where the phone can');
  assert.match(app, /a\.download = 'fargems-sky\.png'/, 'and saved as a file otherwise');
  assert.match(app, /lsSet\('fg\.arOffset', off\)/);
  assert.match(app, /parseOffset\(storedValue\('fg\.arOffset'\)\)/);
  assert.match(read('style.css'), /body\.ar-on \.toast \{ z-index: 70; \}/, 'messages show above the camera view');
});

test('the camera view draws the Moon with its phase when it has one, and the plain disc otherwise', () => {
  const src = read('ar-view.js');
  assert.match(src, /ob\.name === 'Moon' && root\.FarGemsMoon && ob\.phase != null/);
  assert.match(src, /root\.FarGemsMoon\.draw\(ctx, 0, 0, 16, ob\.phase, limb, tilt\)/);
  assert.match(src, /AR\.directionOnScreen\(ob, sun, cam\)/);
});
