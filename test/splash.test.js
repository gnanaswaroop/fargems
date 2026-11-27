'use strict';
// The launch picture an installed iPhone or iPad app shows while it starts: the logo, the app name and the title.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../scripts/make-splash.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const png = (f) => fs.readFileSync(path.join(__dirname, '..', f));

test('one launch picture per device size, each exactly the size of the screen', () => {
  assert.ok(S.DEVICES.length >= 15);
  for (const [w, h, r] of S.DEVICES) {
    const b = png(S.fileName(w, h, r));
    assert.equal(b.subarray(1, 4).toString(), 'PNG');
    assert.equal(b.readUInt32BE(16), w * r, 'width of ' + S.fileName(w, h, r));
    assert.equal(b.readUInt32BE(20), h * r, 'height of ' + S.fileName(w, h, r));
    assert.ok(b.length < 120000, 'small enough: ' + b.length);
  }
  assert.equal(new Set(S.DEVICES.map((d) => S.fileName(...d))).size, S.DEVICES.length, 'no two share a file');
});

test('both pages that can start the app link every picture, with the exact screen size', () => {
  for (const page of ['index.html', 'viewer.html']) {
    const html = read(page);
    for (const d of S.DEVICES) assert.ok(html.includes(S.linkFor(...d)), `${page} links ${S.fileName(...d)}`);
    assert.equal((html.match(/rel="apple-touch-startup-image"/g) || []).length, S.DEVICES.length, page);
  }
});

test('the picture says the app name and the title, on the app background, and the site publishes the folder', () => {
  const page = S.html(390, 844, 'x.png');
  assert.match(page, /Far<b>Gems<\/b>/);
  assert.ok(page.includes(S.TITLE) && /flying above you/.test(S.TITLE));
  assert.ok(page.includes(S.BG));
  assert.match(read('viewer.html'), /boot-title">What’s flying above you</, 'the same words as the in-app loading screen');
  assert.equal(JSON.parse(read('manifest.webmanifest')).background_color, S.BG, 'the same colour as the manifest, so the hand-over does not flash');
  assert.match(read('.github/workflows/pages.yml'), /assets splash _site\//);
});
