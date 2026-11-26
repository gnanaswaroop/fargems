'use strict';
// Names on the radar must read on a light blue day sky as well as a dark night sky, and a name in the camera view must
// not run off the edge of the screen.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const L = require('../lib/logic.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contrast = (a, b) => { const x = lum(rgb(a)), y = lum(rgb(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

test('skyLook: every name is a light colour with a dark outline, at every brightness of the sky', () => {
  for (let k = 0; k <= 1.0001; k += 0.1) {
    const look = L.skyLook(k);
    assert.ok(contrast(look.star, look.halo) >= 7, 'star names at k=' + k.toFixed(1) + ': ' + contrast(look.star, look.halo).toFixed(1));
    assert.ok(contrast(look.ring, look.halo) >= 7, 'ring numbers at k=' + k.toFixed(1));
    assert.ok(contrast('rgb(255,255,255)', look.halo) >= 14, 'body names are white');
    assert.ok(contrast('rgb(255,180,84)', look.halo) >= 7, 'aircraft names');
    assert.ok(contrast('rgb(213,140,255)', look.halo) >= 5, 'meteor shower names');
    assert.ok(look.haloWidth >= 3);
  }
});

test('skyLook: by day the lines and numbers are brighter, and the outline of a dot is stronger', () => {
  const night = L.skyLook(0), day = L.skyLook(1);
  assert.ok(lum(rgb(day.star)) > lum(rgb(night.star)));
  assert.ok(lum(rgb(day.ring)) > lum(rgb(night.ring)));
  assert.match(night.grid, /^rgba\(160,180,210,0\.28\)$/, 'night is as before');
  assert.match(day.grid, /^rgba\(255,255,255,0\.55\)$/);
  assert.ok(Number(day.dotOutline.match(/[\d.]+\)$/)[0].slice(0, -1)) > Number(night.dotOutline.match(/[\d.]+\)$/)[0].slice(0, -1)));
  assert.deepEqual(L.skyLook(NaN), L.skyLook(0), 'no reading means night');
  assert.deepEqual(L.skyLook(9), L.skyLook(1), 'held to the range');
  assert.deepEqual(L.skyLook(-3), L.skyLook(0));
});

test('the radar draws every name with the outline, and takes its colours from the sky', () => {
  const app = read('app.js');
  assert.match(app, /const look = window\.FarGemsLogic\.skyLook\(0\);/, 'the sky is always dark now');
  assert.match(app, /const haloText = \(text, x, y\) => \{[^}]*strokeText\(text, x, y\); ctx\.fillText\(text, x, y\); \};/);
  assert.match(app, /haloText\(L\.text, pick\.x, pick\.y\)/, 'object names');
  assert.match(app, /haloText\('30°'[\s\S]*haloText\('60°'/, 'ring numbers');
  assert.match(app, /label\(o, p, 5, -4, look\.star\)/, 'star names use the sky colour, not a fixed grey');
  assert.doesNotMatch(app, /rgba\(170,182,204,\.75\)/, 'the grey that vanished on blue is gone');
  assert.match(app, /ctx\.strokeStyle = look\.grid;/);
  assert.equal((app.match(/look\.dotOutline/g) || []).length, 2, 'stars and the Sun, Moon and planets get an edge');
});

/* ---- the camera view ---- */
function arEnv(W) {
  const events = [];
  const ctx = new Proxy({}, {
    get: (t, k) => (k === 'measureText' ? (s) => ({ width: String(s).length * 8 }) : k in t ? t[k] : (...a) => { events.push([k, ...a]); }),
    set: (t, k, v) => { t[k] = v; events.push(['set ' + k, v]); return true; },
  });
  const canvas = { width: 0, height: 0, clientWidth: W, clientHeight: 800, getContext: () => ctx, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  const g = {
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } },
    document: { body: { classList: { add() {}, remove() {} } } },
    requestAnimationFrame: (f) => { g.frame = f; return 1; }, cancelAnimationFrame() {}, devicePixelRatio: 1, console,
  };
  g.self = g; g.globalThis = g;
  vm.createContext(g);
  for (const f of ['lib/logic.js', 'lib/ar.js', 'ar-view.js']) vm.runInContext(read(f), g, { filename: f });
  const objects = [];
  const view = g.FarGemsARView.create({
    root: { hidden: true }, video: { srcObject: null, play: async () => {} }, canvas, closeBtn: { addEventListener() {} },
    getObjects: () => objects, getFilters: () => ({ air: true, sat: true, sky: true, labels: true }), getSelected: () => null,
    getOrientation: () => ({ alpha: 0, beta: 90, gamma: 0, absolute: true, declination: 0, compassHeading: 0 }), onSelect() {},
  });
  return { view, events, objects, frame: () => g.frame() };
}
const labelDraw = (events, text) => {
  const i = events.findIndex((e) => e[0] === 'fillText' && e[1] === text);
  assert.ok(i >= 0, text + ' is drawn');
  let align = null; for (let j = i; j >= 0; j--) if (events[j][0] === 'set textAlign') { align = events[j][1]; break; }
  return { x: events[i][2], y: events[i][3], align, w: text.length * 8 };
};

test('a name next to an object near the right edge goes to its left, so it stays on the screen', async () => {
  const e = arEnv(400);
  // Level and facing north: an object 14 degrees to the right is near the right edge (about 363 of 400 pixels).
  e.objects.push({ id: 'body:Mars', kind: 'body', name: 'Mars', az: 14, el: 0, color: '#f66' });
  await e.view.open();
  e.frame();
  const m = labelDraw(e.events, 'Mars');
  assert.equal(m.align, 'right', 'on the left of the object');
  assert.ok(m.x <= 363 - 10, 'the name ends before the object: ' + m.x);
  assert.ok(m.x >= 0 && m.x - m.w >= 0 && m.x <= 400 - 6, 'and is on the screen');
});

test('a name with room on the right stays on the right', async () => {
  const e = arEnv(400);
  e.objects.push({ id: 'body:Mars', kind: 'body', name: 'Mars', az: -5, el: 0, color: '#f66' });
  await e.view.open();
  e.frame();
  const m = labelDraw(e.events, 'Mars');
  assert.equal(m.align, 'left');
  assert.ok(m.x > 200 - 5 * 11 && m.x + m.w < 400);
});

test('a name next to an object on the left edge is kept on the screen too', async () => {
  const e = arEnv(300);
  e.objects.push({ id: 'body:Venus', kind: 'body', name: 'Venus', az: 380 - 360 - 25, el: 0, color: '#ff8' });
  await e.view.open();
  e.frame();
  const m = labelDraw(e.events, 'Venus');
  const left = m.align === 'right' ? m.x - m.w : m.x;
  assert.ok(left >= 3.9 && left + m.w <= 300 - 5.9, 'Venus is whole on the screen: ' + left + ' to ' + (left + m.w));
});
