#!/usr/bin/env node
'use strict';
// Developer tool (not part of the site build): draws the app icons from icon.svg, each one at its own pixel size, so no icon
// is ever a picture that was shrunk or stretched (a shrunk ring turns soft). The artwork comes from icon.svg without its own
// ring; the dark tile and a white ring are drawn around it from the same numbers, and a browser takes a picture of the
// result at exactly the icon's size. Needs a browser to draw with: cd e2e/ios && npm ci && npx playwright install chromium
//
//   node scripts/make-icons.js
//
//   icon-512.png, icon-192.png        round: a circle on a transparent square, the ring at the edge
//   icon-maskable-512.png (Android)   a full square the system cuts to its own shape; the ring sits inside the part no mask cuts
//   apple-touch-icon.png (iPhone)     the same full square at 180 px, rounded by iOS
//
// The PNGs come straight from the browser's screenshot: no metadata chunks (a test checks that), and no palette squeeze.
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');

const ART_RADIUS = 146;      // the radius of the ring that icon.svg draws around the logo, in its own units: all artwork is inside it
const ART_CENTRE = [256, 262]; // where that ring is centred
const ART_FIT = 0.94;         // how much of the space inside the ring the artwork uses
const ROUND_RING = 0.02;     // ring thickness of the round icons, as a share of the icon size (10 px at 512)
const FULL_RING = 0.022;     // ring thickness of the full-bleed icons
const SAFE_RADIUS = 0.385;   // of the icon size: the ring's centre line on a full-bleed icon, so with half its thickness it stays inside the 40% radius no mask cuts

const ICONS = [
  { file: 'icon-512.png', size: 512, round: true },
  { file: 'icon-192.png', size: 192, round: true },
  { file: 'icon-maskable-512.png', size: 512, round: false },
  { file: 'apple-touch-icon.png', size: 180, round: false },
];

// The icon as SVG at size n: the tile, the artwork scaled to sit inside the ring, then the ring.
function iconSvg(art, n, round) {
  const sw = n * (round ? ROUND_RING : FULL_RING);
  const ringR = round ? n / 2 - sw / 2 : n * SAFE_RADIUS;       // the ring's centre line
  const scale = ART_FIT * (ringR - sw / 2) / ART_RADIUS;         // the artwork's own ring would land on the ring's inner edge; a little smaller leaves room
  const [cx, cy] = ART_CENTRE;
  const tile = round ? `<circle cx="${n / 2}" cy="${n / 2}" r="${n / 2}" fill="url(#tile)"/>` : `<rect width="${n}" height="${n}" fill="url(#tile)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n}" height="${n}" viewBox="0 0 ${n} ${n}">
  <defs><radialGradient id="tile" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#173d63"/><stop offset=".45" stop-color="#112447"/><stop offset="1" stop-color="#0b1836"/></radialGradient></defs>
  ${tile}
  <g transform="translate(${n / 2} ${n / 2}) scale(${scale}) translate(${-cx} ${-cy})">${art}</g>
  <circle cx="${n / 2}" cy="${n / 2}" r="${ringR}" fill="none" stroke="#ffffff" stroke-width="${sw}"/>
</svg>`;
}

// The artwork of icon.svg: everything inside the <svg> element except the ring it draws around itself.
function artwork() {
  const svg = fs.readFileSync(path.join(ROOT, 'icon.svg'), 'utf8');
  const inner = svg.slice(svg.indexOf('>', svg.indexOf('<svg')) + 1, svg.lastIndexOf('</svg>'));
  return inner.replace(/<circle id="ring"[^>]*\/>/, '');
}

function load() {
  for (const dir of [path.join(ROOT, 'e2e', 'ios', 'node_modules', 'playwright'), 'playwright']) {
    try { return require(dir); } catch { /* try the next */ }
  }
  throw new Error('Playwright is not installed (cd e2e/ios && npm ci && npx playwright install chromium)');
}

async function main() {
  const { chromium } = load();
  const art = artwork();
  const browser = await chromium.launch();
  for (const { file, size, round } of ICONS) {
    // One page per icon, as big as the icon and at one device pixel per pixel, so the screenshot is the icon itself.
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}svg{display:block}</style>${iconSvg(art, size, round)}`);
    const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    fs.writeFileSync(path.join(ROOT, file), png);
    await page.close();
    console.log(file, size + 'x' + size, png.length + ' bytes');
  }
  await browser.close();
}
if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { iconSvg, ICONS, ART_FIT, SAFE_RADIUS, FULL_RING, ROUND_RING, ART_RADIUS };
