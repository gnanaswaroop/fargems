#!/usr/bin/env node
'use strict';
// Developer tool (not part of the site build): draws the launch pictures an installed iPhone or iPad app shows while it
// starts (Android builds its own from the manifest name and icon). Each one is the same loading screen the sky view shows:
// the logo, the app name and the title on the app's dark background. iOS picks the picture by exact screen size, so there is
// one per device size, upright only. Needs a browser to draw with: cd e2e/ios && npm ci && npx playwright install chromium
//
//   node scripts/make-splash.js        writes splash/*.png and prints the <link> lines the pages carry
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');

const BG = '#070b14', ACCENT = '#5ad1e6', MUTED = '#8a97ad', TEXT = '#e6ecf5';
const TITLE = 'What’s flying above you';

// [width, height] in CSS points (upright) and the pixel ratio, for the devices still in use.
const DEVICES = [
  [440, 956, 3], [402, 874, 3], [430, 932, 3], [393, 852, 3], [428, 926, 3], [390, 844, 3], [375, 812, 3], [414, 896, 3],
  [414, 896, 2], [414, 736, 3], [375, 667, 2], [320, 568, 2],
  [1024, 1366, 2], [834, 1194, 2], [834, 1112, 2], [820, 1180, 2], [810, 1080, 2], [768, 1024, 2],
];
const fileName = (w, h, r) => `splash/launch-${w * r}x${h * r}.png`;
const linkFor = (w, h, r) => `<link rel="apple-touch-startup-image" href="${fileName(w, h, r)}" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait)">`;

// The page that is photographed: sized in CSS points, so the picture is the same screen at any pixel ratio.
function html(w, h, logo) {
  const k = Math.min(1, w / 400);   // a little smaller on the smallest screens
  return `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;width:${w}px;height:${h}px;background:${BG};color:${TEXT};font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
    .b{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${8 * k}px;text-align:center;padding:24px;box-sizing:border-box}
    img{width:${96 * k}px;height:${96 * k}px}
    .n{font-size:${34 * k}px;font-weight:500;letter-spacing:.3px}.n b{color:${ACCENT};font-weight:700}
    .t{color:${MUTED};font-size:${16 * k}px}
  </style><div class="b"><img src="${logo}" alt=""><div class="n">Far<b>Gems</b></div><div class="t">${TITLE}</div></div>`;
}

function load() {
  for (const dir of [path.join(ROOT, 'e2e', 'ios', 'node_modules', 'playwright'), 'playwright']) {
    try { return require(dir); } catch { /* try the next */ }
  }
  throw new Error('Playwright is not installed (cd e2e/ios && npm ci && npx playwright install chromium)');
}

async function main() {
  const { chromium } = load();
  const logo = 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(ROOT, 'icon.svg')).toString('base64');
  fs.mkdirSync(path.join(ROOT, 'splash'), { recursive: true });
  const browser = await chromium.launch();
  for (const [w, h, r] of DEVICES) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: r });
    await page.setContent(html(w, h, logo));
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: w, height: h } });
    fs.writeFileSync(path.join(ROOT, fileName(w, h, r)), png);
    await page.close();
    console.log(fileName(w, h, r), png.length + ' bytes');
  }
  await browser.close();
  console.log('\n' + DEVICES.map((d) => linkFor(...d)).join('\n'));
}
if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { DEVICES, BG, TITLE, fileName, linkFor, html };
