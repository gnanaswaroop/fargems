'use strict';
// The logo has a thin white ring around it: in the SVG used on the pages and in the round app icons.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('icon.svg has a thin white ring that is only an outline and fits inside the picture', () => {
  const svg = read('icon.svg');
  const ring = svg.match(/<circle id="ring"([^>]*)\/>/);
  assert.ok(ring, 'a ring is there');
  const a = (n) => (ring[1].match(new RegExp(n + '="([^"]+)"')) || [])[1];
  assert.equal(a('fill'), 'none', 'an outline only: nothing painted inside, so the logo stays transparent');
  assert.equal(a('stroke').toUpperCase(), '#FFFFFF', 'white');
  const w = Number(a('stroke-width')), r = Number(a('r')), cx = Number(a('cx')), cy = Number(a('cy'));
  assert.ok(w >= 2 && w <= 6, 'thin: ' + w);
  const vb = svg.match(/viewBox="([\d.\s-]+)"/)[1].trim().split(/\s+/).map(Number);
  assert.ok(cx - r - w / 2 >= vb[0] && cx + r + w / 2 <= vb[0] + vb[2], 'the ring is inside the picture, side to side');
  assert.ok(cy - r - w / 2 >= vb[1] && cy + r + w / 2 <= vb[1] + vb[3], 'and top to bottom');
  assert.ok(Math.abs(cx - (vb[0] + vb[2] / 2)) < 1 && Math.abs(cy - (vb[1] + vb[3] / 2)) < 1, 'centred in the picture');
  assert.ok(svg.lastIndexOf('id="ring"') > svg.lastIndexOf('id="stars"'), 'drawn last, on top');
  // The logo is still one picture with nothing else painted behind it.
  const outsideMask = svg.replace(/<mask[\s\S]*?<\/mask>/g, '');
  assert.ok(!/<rect/.test(outsideMask), 'still no background');
});

test('the artwork fits inside the ring with room to spare', () => {
  // The farthest drawn points of the artwork, from the middle of the ring (the reticle's lines and the diamond's corners).
  const cx = 256, cy = 262;
  const far = [[324, 147], [359, 182], [374, 232], [138, 232], [256, 370], [176, 184]].map(([x, y]) => Math.hypot(x - cx, y - cy));
  assert.ok(Math.max(...far) + 3 < 146 - 2, 'nothing touches the ring: ' + Math.max(...far).toFixed(1) + ' against 146');
});

test('all four app icons have the ring, made by a script that also shrinks them', () => {
  const s = read('scripts/make-icons.js');
  assert.match(s, /const RING = 10;/);
  assert.match(s, /x\.strokeStyle = '#ffffff'; x\.lineWidth = RING;/, 'the round icons: the old edge is repainted and a ring drawn');
  assert.match(s, /const SAFE_RADIUS = 0\.385;/, 'the full-bleed icons: the ring sits inside the part no mask cuts');
  assert.match(s, /const FULL_RING = 0\.022;/);
  // Thick enough to stay a clean line when the phone shrinks the icon (the old ring was a hairline and came out blurry),
  // and its outer edge inside the 40% radius of a round mask.
  assert.ok(0.385 + 0.022 / 2 <= 0.4, 'the ring is not cut by a round mask');
  assert.ok(0.022 * 144 >= 3, 'about three pixels or more at a 144 px home-screen icon');
  for (const f of ['icon-512.png', 'icon-192.png', 'icon-maskable-512.png', 'apple-touch-icon.png']) assert.ok(s.includes(f), f);
  assert.match(s, /shrink-png\.py/, 'and the PNGs are shrunk');
  assert.match(read('scripts/shrink-png.py'), /quantize\(colors=256/);
  assert.match(read('scripts/shrink-png.py'), /dither=Image\.Dither\.NONE/, 'no dithering on the ring edge');
  // Together the four icons are what the service worker downloads when it installs: a canvas export came to 600 KB.
  const total = ['icon-512.png', 'icon-192.png', 'icon-maskable-512.png', 'apple-touch-icon.png'].reduce((n, f) => n + fs.statSync(path.join(__dirname, '..', f)).size, 0);
  assert.ok(total < 80 * 1024, 'the four icons are ' + Math.round(total / 1024) + ' KB');
});
