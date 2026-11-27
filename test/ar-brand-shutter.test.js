'use strict';
// The camera view names the app in its top left corner (drawn on the picture, so a saved picture has it too), and the camera
// button is a round shutter at the bottom right, above the card when the card is open.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function env({ logoLoads = true, inset = 0 } = {}) {
  let cb = null;
  const calls = [];
  const ctx = new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : (...a) => { calls.push([k, ...a, t.font, t.globalAlpha]); return { width: 10 }; }),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const canvas = { width: 0, height: 0, clientWidth: 400, clientHeight: 800, getContext: () => ctx, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  class Img { constructor() { this.complete = logoLoads; this.naturalWidth = logoLoads ? 192 : 0; } }
  const added = [];
  const g = {
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } },
    document: { body: { classList: { add() {}, remove() {} } }, createElement: () => ({ style: {}, remove() {} }) },
    getComputedStyle: () => ({ paddingTop: inset + 'px' }),
    Image: Img, requestAnimationFrame: (f) => { cb = f; return 1; }, cancelAnimationFrame() {}, performance: { now: () => 1000 }, devicePixelRatio: 1, console,
  };
  g.self = g; g.globalThis = g; vm.createContext(g);
  for (const f of ['lib/logic.js', 'lib/ar.js', 'ar-view.js']) vm.runInContext(read(f), g, { filename: f });
  const root = { hidden: true, appendChild: (n) => added.push(n) };
  const view = g.FarGemsARView.create({
    root, video: { srcObject: null, play: async () => {} }, canvas, closeBtn: { addEventListener() {} },
    getObjects: () => [], getFilters: () => ({ air: true, sat: true, sky: true, labels: true }), getSelected: () => null,
    getOrientation: () => ({ alpha: 0, beta: 90, gamma: 0, compassHeading: 0, absolute: true }), onSelect() {}, onClose() {},
  });
  return { view, calls, frame: () => { calls.length = 0; if (cb) cb(); } };
}

test('the app name and logo are drawn small in the top left corner of the camera picture', async () => {
  const e = env({ inset: 47 });
  await e.view.open(); e.frame();
  const text = e.calls.find((c) => c[0] === 'fillText' && c[1] === 'FarGems');
  assert.ok(text, 'the name is drawn');
  assert.ok(text[2] < 60 && text[3] > 30 && text[3] < 47 + 40, 'at the top left, level with the close button, below the notch: ' + JSON.stringify(text.slice(1, 4)));
  assert.match(text[4], /^600 1[2-6]px /, 'small type: ' + text[4]);
  assert.ok(text[5] <= 0.9, 'a little see-through so it does not shout');
  const logo = e.calls.find((c) => c[0] === 'drawImage');
  assert.ok(logo, 'the logo is drawn');
  assert.ok(logo[4] <= 24 && logo[5] <= 24 && logo[2] < text[2], 'a small logo before the name: ' + JSON.stringify(logo.slice(2, 6)));
  assert.ok(e.calls.some((c) => c[0] === 'strokeText' && c[1] === 'FarGems'), 'with an outline so it can be read on bright sky');
});

test('the compass reading is under the app name, not on top of it, and below the notch', async () => {
  const e = env({ inset: 47 });
  await e.view.open(); e.frame();
  const name = e.calls.find((c) => c[0] === 'fillText' && c[1] === 'FarGems');
  const reading = e.calls.find((c) => c[0] === 'fillText' && /° · /.test(c[1]));
  assert.ok(reading, 'the reading is drawn');
  assert.ok(reading[3] >= name[3] + 18, 'under the name: ' + JSON.stringify([name[3], reading[3]]));
  assert.ok(reading[3] > 47, 'and below the notch');
});

test('the name is still drawn when the logo has not loaded, and the name sits where the logo would have been', async () => {
  const e = env({ logoLoads: false });
  await e.view.open(); e.frame();
  assert.equal(e.calls.some((c) => c[0] === 'drawImage'), false, 'no logo to draw');
  const text = e.calls.find((c) => c[0] === 'fillText' && c[1] === 'FarGems');
  assert.ok(text && text[2] === 14, 'the name starts at the margin');
});

test('the name is drawn on the camera canvas, so a saved picture (which copies that canvas) has it', () => {
  const src = read('ar-view.js');
  assert.match(src, /brand\(\);\r?\n\s*crosshair\(W, H\);/, 'drawn every frame, before anything can stop the frame early');
  assert.match(src, /c\.drawImage\(o\.canvas, 0, 0\);/, 'the picture copies the overlay canvas');
  assert.match(src, /new Date\(\)\.toLocaleString\(\[\], \{ dateStyle: 'medium', timeStyle: 'short' \}\)/, 'the caption underneath is just the time');
  assert.doesNotMatch(src, /'FarGems · '/);
  assert.match(src, /icon-192\.png/, 'a same-site PNG, which does not stop the picture being saved');
});

test('the camera button is a round shutter in the bottom controls, with Align on the other side, and no longer a text button at the top right', () => {
  const v = read('viewer.html'), css = read('style.css');
  assert.match(v, /<div class="ar-controls">\s*<button id="arAlign" class="btn ar-tool"[^>]*>Align<\/button>\s*<button id="arShot" class="ar-shutter" type="button" aria-label="Take a picture with the labels on it" title="Take a picture"><span aria-hidden="true"><\/span><\/button>/);
  assert.doesNotMatch(v, /class="ar-tools"/);
  assert.doesNotMatch(v, />Photo</, 'no text button');
  assert.ok(v.indexOf('class="ar-controls"') < v.indexOf('id="arDetail"'), 'the controls come first, so they sit above the card');
  assert.match(v, /<div class="ar-bottom">[\s\S]*id="arDetail"[\s\S]*<\/div>\s*<\/div>/, 'the card is in the same bottom column');
  assert.match(css, /\.ar-bottom \{ position: absolute; left: 10px; right: 10px; bottom: calc\(10px \+ env\(safe-area-inset-bottom\)\); display: flex; flex-direction: column;/);
  assert.match(css, /\.ar-controls \{ display: flex; align-items: flex-end; justify-content: space-between;/);
  assert.match(css, /\.ar-shutter \{[^}]*width: 64px; height: 64px;[^}]*border-radius: 50%;/);
  assert.match(css, /\.ar-detail \{ position: relative;/, 'the card is part of the column, not placed on its own, and its close cross belongs to the card and not to the column');
  assert.doesNotMatch(css, /\.ar-tools \{/);
  assert.match(css, /\.ar-alignbar \{[^}]*right: 68px;/, 'the line-up note no longer leaves room for a column of buttons');
});
