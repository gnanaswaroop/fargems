#!/usr/bin/env node
'use strict';
// Developer tool (not part of the site build): gives the round app icons (icon-512.png and icon-192.png) a thin white ring
// in place of the old teal edge. It keeps the artwork and the dark tile as they are, repaints only the edge band, and writes
// both sizes. Needs a browser to draw with: cd e2e/ios && npm ci && npx playwright install chromium
//
//   node scripts/make-icons.js
//
// The PNGs come out of a canvas, so they carry no metadata chunks (a test checks that). Run it once on the original artwork;
// running it again on its own output just repaints the same ring.
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const RING = 5;        // white ring thickness at 512 px
const BAND = 12;       // width of the old teal edge that is repainted in the tile colour, at 512 px

function load() {
  for (const dir of [path.join(ROOT, 'e2e', 'ios', 'node_modules', 'playwright'), 'playwright']) {
    try { return require(dir); } catch { /* try the next */ }
  }
  throw new Error('Playwright is not installed (cd e2e/ios && npm ci && npx playwright install chromium)');
}

async function main() {
  const { chromium } = load();
  const src = 'data:image/png;base64,' + fs.readFileSync(path.join(ROOT, 'icon-512.png')).toString('base64');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const out = await page.evaluate(async ({ src, RING, BAND }) => {
    const img = new Image(); img.src = src; await img.decode();
    const c = document.createElement('canvas'); c.width = 512; c.height = 512;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    // The tile colour just inside the old edge (it fades slightly from the middle to the edge, so take it there).
    const p = x.getImageData(256, BAND + 1, 1, 1).data;
    const tile = `rgb(${p[0]},${p[1]},${p[2]})`;
    x.save(); x.beginPath(); x.arc(256, 256, 256, 0, Math.PI * 2); x.arc(256, 256, 256 - BAND, 0, Math.PI * 2, true); x.clip('evenodd');
    x.fillStyle = tile; x.fillRect(0, 0, 512, 512); x.restore();
    x.strokeStyle = '#ffffff'; x.lineWidth = RING; x.beginPath(); x.arc(256, 256, 256 - RING / 2, 0, Math.PI * 2); x.stroke();
    const small = document.createElement('canvas'); small.width = 192; small.height = 192;
    const s = small.getContext('2d'); s.imageSmoothingEnabled = true; s.imageSmoothingQuality = 'high'; s.drawImage(c, 0, 0, 192, 192);
    return { big: c.toDataURL('image/png'), small: small.toDataURL('image/png'), tile };
  }, { src, RING, BAND });
  await browser.close();
  const png = (url) => Buffer.from(url.split(',')[1], 'base64');
  fs.writeFileSync(path.join(ROOT, 'icon-512.png'), png(out.big));
  fs.writeFileSync(path.join(ROOT, 'icon-192.png'), png(out.small));
  console.log('icon-512.png and icon-192.png written; tile colour', out.tile);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
