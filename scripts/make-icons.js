#!/usr/bin/env node
'use strict';
// Developer tool (not part of the site build): gives the app icons a thin white ring. The round icons (icon-512.png and
// icon-192.png) get it in place of the old teal edge: the artwork and the dark tile stay, only the edge band is repainted. The
// full-bleed icons that the system crops itself (icon-maskable-512.png for Android, apple-touch-icon.png for iPhone) get a
// ring too, drawn inside the part that is never cropped (the middle 80%), so the installed icon shows it whatever shape the
// phone cuts it to. Needs a browser to draw with: cd e2e/ios && npm ci && npx playwright install chromium
//
//   node scripts/make-icons.js
//
// The PNGs come out of a canvas, so they carry no metadata chunks (a test checks that). Run it once on the original artwork;
// running it again on its own output just repaints the same ring.
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const RING = 5;        // white ring thickness at 512 px
const SAFE_RADIUS = 0.395; // of the icon size: inside the 40% radius that no mask cuts
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
  // The full-bleed icons: the same ring, well inside the edge.
  const full = {};
  for (const file of ['icon-maskable-512.png', 'apple-touch-icon.png']) {
    const url = 'data:image/png;base64,' + fs.readFileSync(path.join(ROOT, file)).toString('base64');
    full[file] = await page.evaluate(async ({ url, SAFE_RADIUS }) => {
      const img = new Image(); img.src = url; await img.decode();
      const n = img.naturalWidth, c = document.createElement('canvas'); c.width = n; c.height = n;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      x.strokeStyle = '#ffffff'; x.lineWidth = Math.max(2, n * 0.0098); x.beginPath(); x.arc(n / 2, n / 2, n * SAFE_RADIUS, 0, Math.PI * 2); x.stroke();
      return c.toDataURL('image/png');
    }, { url, SAFE_RADIUS });
  }
  await browser.close();
  const png = (url) => Buffer.from(url.split(',')[1], 'base64');
  fs.writeFileSync(path.join(ROOT, 'icon-512.png'), png(out.big));
  fs.writeFileSync(path.join(ROOT, 'icon-192.png'), png(out.small));
  for (const [file, url] of Object.entries(full)) fs.writeFileSync(path.join(ROOT, file), png(url));
  console.log('icon-512.png, icon-192.png, icon-maskable-512.png and apple-touch-icon.png written; tile colour', out.tile);
  // A canvas export is not compressed well (the four icons came to 600 KB, which the service worker downloads when it installs). A 256-colour palette brings them to about 45 KB.
  try { require('node:child_process').execFileSync('python', [path.join(__dirname, 'shrink-png.py'), ...['icon-512.png', 'icon-192.png', 'icon-maskable-512.png', 'apple-touch-icon.png'].map((f) => path.join(ROOT, f))], { stdio: 'inherit' }); }
  catch { console.warn('Python with Pillow was not found: the icons are written but not shrunk (python scripts/shrink-png.py icon-512.png ...)'); }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
