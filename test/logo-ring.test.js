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

test('all four app icons are drawn from icon.svg at their own size, with a ring that is thick enough to stay sharp', () => {
  const M = require('../scripts/make-icons.js');
  const s = read('scripts/make-icons.js');
  // Drawn, not resized: every icon is a screenshot of a page the size of the icon, and no palette squeeze is applied afterwards.
  assert.match(s, /viewport: \{ width: size, height: size \}, deviceScaleFactor: 1/);
  assert.doesNotMatch(s, /drawImage|imageSmoothing|shrink-png/, 'no picture is scaled');
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'scripts', 'shrink-png.py')), false);
  assert.deepEqual(M.ICONS.map((i) => [i.file, i.size, i.round]), [['icon-512.png', 512, true], ['icon-192.png', 192, true], ['icon-maskable-512.png', 512, false], ['apple-touch-icon.png', 180, false]]);
  for (const { file, size } of M.ICONS) {
    const png = fs.readFileSync(path.join(__dirname, '..', file));
    assert.equal(png.readUInt32BE(16), size, file + ' is ' + size + ' px wide');
    assert.equal(png.readUInt32BE(20), size, file + ' is ' + size + ' px high');
    assert.notEqual(png[25], 3, file + ' is not a palette image');
  }
  // The ring: at least 3 px thick at a 144 px home-screen icon, and on the full-bleed icons its outer edge stays inside the 40% radius a round mask leaves.
  assert.ok(M.FULL_RING * 144 >= 3 && M.ROUND_RING * 144 >= 2.5);
  assert.ok(M.SAFE_RADIUS + M.FULL_RING / 2 <= 0.4, 'the ring is not cut by a round mask');
  // The geometry in the SVG it draws: the ring is centred where the numbers say, and the artwork inside is smaller than the ring.
  const round = M.iconSvg('<g id="art"/>', 512, true), full = M.iconSvg('<g id="art"/>', 512, false);
  assert.match(round, /<circle cx="256" cy="256" r="250\.88" fill="none" stroke="#ffffff" stroke-width="10\.24"/, 'the ring touches the edge of the round icon');
  assert.match(full, new RegExp('<circle cx="256" cy="256" r="' + (512 * M.SAFE_RADIUS) + '" fill="none" stroke="#ffffff"'));
  for (const svg of [round, full]) { const k = +svg.match(/scale\(([\d.]+)\)/)[1]; assert.ok(k * M.ART_RADIUS < 250, 'the artwork is inside the ring'); }
  // The artwork is taken from icon.svg without its own ring.
  const art = read('icon.svg');
  assert.match(art, /<circle id="ring"/);
  assert.ok(s.includes('inner.replace(/<circle id="ring"'), 'the ring of icon.svg is left out of the artwork');
  // Together the icons are what the service worker downloads when it installs; drawn at full quality they are bigger than the squeezed ones were, but stay modest.
  const total = M.ICONS.reduce((n, i) => n + fs.statSync(path.join(__dirname, '..', i.file)).size, 0);
  assert.ok(total < 450 * 1024, 'the four icons are ' + Math.round(total / 1024) + ' KB');
});

test('the icon tile is one flat colour: a gradient behind the logo read as a blurry glow on the home screen', () => {
  const M = require('../scripts/make-icons.js');
  for (const round of [true, false]) {
    const svg = M.iconSvg('<g id="art"/>', 512, round);
    assert.doesNotMatch(svg, /Gradient|url\(#/, 'no gradient or other soft fill');
    assert.ok(svg.includes(`fill="${M.TILE}"`), 'the tile is the flat colour');
  }
});
