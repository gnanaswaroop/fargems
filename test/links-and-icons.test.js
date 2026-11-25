'use strict';
// Every link on every page goes somewhere real, and the app icons are round, free of a square black background, and
// declared properly for installing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const exists = (f) => fs.existsSync(path.join(__dirname, '..', f));
const PAGES = ['index.html', 'about.html', 'viewer.html', 'settings.html'];

function links(html) {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({
    attrs: m[1], text: m[2].replace(/<[^>]+>/g, '').trim(),
    href: (m[1].match(/\bhref="([^"]*)"/) || [])[1],
    label: (m[1].match(/aria-label="([^"]*)"/) || [])[1],
  }));
}

test('every link on every page has a real destination, a readable name, and external links are safe', () => {
  for (const page of PAGES) {
    const html = read(page);
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
    for (const l of links(html)) {
      assert.ok(l.href && l.href !== '#' && !/^javascript:/i.test(l.href), `${page}: a link without a destination (${l.text})`);
      assert.ok(l.text || l.label, `${page}: link to ${l.href} has no name for a screen reader`);
      if (/^https?:/.test(l.href)) {
        assert.match(l.href, /^https:/, `${page}: ${l.href} should be https`);
        if (/target="_blank"/.test(l.attrs)) assert.match(l.attrs, /rel="[^"]*noopener/, `${page}: ${l.href} opens a new tab safely`);
      } else if (l.href.startsWith('#')) {
        assert.ok(ids.has(l.href.slice(1)), `${page}: ${l.href} points at an id that exists`);
      } else {
        const file = l.href.split(/[?#]/)[0];
        assert.ok(exists(file), `${page}: link to ${l.href} goes to a file that exists`);
      }
    }
  }
});

test('the pages link to each other so nobody is stranded', () => {
  const to = (page) => links(read(page)).map((l) => l.href);
  assert.ok(to('index.html').includes('viewer.html') && to('index.html').includes('about.html') && to('index.html').includes('settings.html'), 'home: sky view, About and Settings');
  assert.ok(to('viewer.html').includes('settings.html') && to('viewer.html').includes('index.html'), 'sky view: Settings and home (the logo)');
  assert.ok(to('settings.html').includes('viewer.html') && to('settings.html').includes('index.html'), 'settings: back to the sky view and home');
  assert.ok(to('about.html').includes('index.html'), 'About: back');
});

test('the About page has a proper Back button that returns to where the visitor came from', () => {
  const html = read('about.html'), css = read('style.css'), js = read('nav.js');
  assert.match(html, /<a class="back-link" href="index\.html" data-back>&larr; Back<\/a>/);
  assert.match(css, /\.back-link\{display:inline-flex[^}]*border-radius:999px/, 'a pill button, not a bare underlined link');
  assert.match(js, /history\.back\(\)/);
  assert.match(js, /origin === location\.origin/, 'only goes back to a page of this site');
  assert.ok(html.indexOf('lib/update.js') > -1 && html.includes('<script src="nav.js"></script>'));
  assert.match(read('sw.js'), /'nav\.js'/);
  assert.match(read('.github/workflows/pages.yml'), /nav\.js/);
});

test('the home menu has Settings (not "Change permissions"), and the installed app shows the name in plain white', () => {
  const menu = read('index.html').match(/<ul id="menuList"[\s\S]*?<\/ul>/)[0];
  assert.match(menu, /<a href="settings\.html">Settings<\/a>/);
  assert.doesNotMatch(menu, /Change permissions/);
  assert.match(read('style.css'), /@media \(display-mode: standalone\)\{ \.brand b\{color:inherit\} \}/);
});

function png(file) {
  const d = fs.readFileSync(path.join(__dirname, '..', file));
  assert.equal(d.subarray(1, 4).toString(), 'PNG', file + ' is a PNG');
  return { w: d.readUInt32BE(16), h: d.readUInt32BE(20), colorType: d[25], data: d };
}
// Pixel access for the few sizes used here, by decoding the PNG with Node's zlib (8-bit RGB or RGBA, no interlace).
function pixel(file, x, y) {
  const zlib = require('node:zlib');
  const { w, h, data, colorType } = png(file);
  let o = 8, idat = [];
  while (o < data.length) { const len = data.readUInt32BE(o), type = data.subarray(o + 4, o + 8).toString(); if (type === 'IDAT') idat.push(data.subarray(o + 8, o + 8 + len)); o += 12 + len; }
  const raw = zlib.inflateSync(Buffer.concat(idat)), bpp = colorType === 6 ? 4 : 3, stride = w * bpp, out = Buffer.alloc(h * stride);
  for (let row = 0; row < h; row++) {
    const f = raw[row * (stride + 1)], src = raw.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[row * stride + i - bpp] : 0, b = row ? out[(row - 1) * stride + i] : 0, c = i >= bpp && row ? out[(row - 1) * stride + i - bpp] : 0;
      const pr = (() => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : (pb <= pc ? b : c); })();
      out[row * stride + i] = (src[i] + (f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? ((a + b) >> 1) : pr)) & 255;
    }
  }
  const i = y * stride + x * bpp;
  return [out[i], out[i + 1], out[i + 2], bpp === 4 ? out[i + 3] : 255];
}

test('app icons: round with transparent corners for the "any" icons, full-bleed for maskable and iOS', () => {
  for (const [file, size] of [['icon-192.png', 192], ['icon-512.png', 512]]) {
    const p = png(file);
    assert.equal(p.w, size); assert.equal(p.h, size); assert.equal(p.colorType, 6, 'RGBA');
    assert.equal(pixel(file, 1, 1)[3], 0, `${file}: the corner is transparent, so no square background shows`);
    assert.equal(pixel(file, size - 2, size - 2)[3], 0);
    assert.equal(pixel(file, size >> 1, 6)[3], 255, `${file}: the circle reaches the middle of its edge`);
  }
  for (const [file, size] of [['icon-maskable-512.png', 512], ['apple-touch-icon.png', 180]]) {
    const p = png(file);
    assert.equal(p.w, size); assert.equal(p.h, size);
    assert.equal(pixel(file, 1, 1)[3], 255, `${file}: full bleed, so the system can round it itself`);
    const [r, g, b] = pixel(file, 1, 1);
    assert.ok(b > r && b > g - 10 && b < 90, `${file}: a deep navy, not black (${r},${g},${b})`);
  }
});

test('the manifest declares round "any" icons and a separate maskable icon, and the pages publish them', () => {
  const icons = JSON.parse(read('manifest.webmanifest')).icons;
  const by = (purpose) => icons.filter((i) => i.purpose === purpose).map((i) => i.src);
  assert.deepEqual(by('any').sort(), ['icon-192.png', 'icon-512.png', 'icon.svg']);
  assert.deepEqual(by('maskable'), ['icon-maskable-512.png']);
  assert.ok(!icons.some((i) => /any maskable/.test(i.purpose)), 'no icon is both: a round icon cannot be cropped again');
  assert.match(read('.github/workflows/pages.yml'), /icon-maskable-512\.png/);
  assert.match(read('sw.js'), /'icon-maskable-512\.png'/);
});
