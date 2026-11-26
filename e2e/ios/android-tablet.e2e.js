'use strict';
// An Android tablet in Chrome's engine (Chromium): the Galaxy Tab S4 profile (screen size, touch, Android user agent).
// It is not a real tablet: there is no real GPS or compass, so the tests give the page a position, a refusal or an
// error the way Chrome on Android does, and fire the install events the way Chrome does. It checks that the page
// does the right thing with them. It does not replace trying the app on a real tablet.
//
// Run: npm run test:tablet     (needs: cd e2e/ios && npm ci && npx playwright install chromium)
const { test } = require('./shard.js'); // like node:test, but runs only this run's share when FG_SHARD=2/4 is set
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

let playwright = null;
try { playwright = require('playwright'); } catch { /* not installed: the tests skip */ }
const skip = playwright ? false : 'Playwright is not installed (run: cd e2e/ios && npm ci && npx playwright install chromium)';

const ROOT = path.resolve(__dirname, '..', '..');
const HITEC = { latitude: 17.4435, longitude: 78.3772 }; // HITEC City, Hyderabad
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

let server, base, browser;
test.before(async () => {
  if (skip) return;
  server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, r));
  base = 'http://localhost:' + server.address().port;
  browser = await playwright.chromium.launch();
});
test.after(async () => { if (browser) await browser.close(); if (server) server.close(); });

// permission: 'granted' gives the browser's location permission up front; otherwise the page has to ask (the tap that
// asks is answered by geolocation below). geo: a position, or { error: code } for a failed lookup.
async function tablet({ permission = false, geo = HITEC, storage = {}, landscape = true } = {}) {
  const context = await browser.newContext({
    ...playwright.devices[landscape ? 'Galaxy Tab S4 landscape' : 'Galaxy Tab S4'],
    geolocation: geo && !geo.error ? geo : undefined, permissions: permission ? ['geolocation'] : [],
  });
  await context.addInitScript(({ storage, geo }) => {
    for (const [k, v] of Object.entries(storage)) { try { if (!localStorage.getItem('__seeded')) localStorage.setItem(k, v); } catch { /* blocked */ } }
    try { localStorage.setItem('__seeded', '1'); } catch { /* blocked */ }
    if (geo && geo.error) {
      navigator.geolocation.getCurrentPosition = (ok, fail) => setTimeout(() => fail && fail({ code: geo.error, message: 'test' }), 50);
    }
  }, { storage, geo });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => { if (!/access control checks|Fetch API cannot load|Load failed/.test(String(e))) errors.push(String(e)); });
  return { page, context, errors };
}

test('tablet: the browser already allows location, so the first visit goes straight to the sky view', { skip }, async () => {
  const { page, context, errors } = await tablet({ permission: true });
  try {
    await page.goto(base + '/index.html');
    await page.waitForURL('**/viewer.html', { timeout: 10000 });
    assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('fg.loc')).lat > 17), 'the place was kept');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('tablet: a visit after that stays on the home page, with the sky view one tap away', { skip }, async () => {
  const { page, context } = await tablet({ permission: true, storage: { 'fg.loc': JSON.stringify({ lat: 17.4435, lon: 78.3772 }) } });
  try {
    await page.goto(base + '/index.html');
    await page.waitForTimeout(1200);
    assert.match(page.url(), /index\.html$/);
    assert.equal(await page.isVisible('#openLink'), true);
    assert.equal(await page.isVisible('#permsCard'), false, 'nothing left to allow');
  } finally { await context.close(); }
});

test('tablet: asks for one permission, location, and not for the compass', { skip }, async () => {
  const { page, context } = await tablet({ permission: false });
  try {
    await page.goto(base + '/index.html');
    assert.equal((await page.textContent('#permsTitle')).trim(), 'One permission');
    assert.equal((await page.textContent('#allowBtn')).trim(), 'Allow location');
    assert.equal(await page.isVisible('#compassRow'), false, 'no compass row: nothing to allow');
    assert.doesNotMatch(await page.innerText('#permsCard'), /compass/i);
    assert.equal(await page.getAttribute('#heroLink', 'title'), 'Allow location');
    assert.equal(await page.isVisible('#installCard'), true);
  } finally { await context.close(); }
});

test('tablet: allowing location opens the sky view', { skip }, async () => {
  const { page, context } = await tablet({ permission: true, storage: {} });
  try {
    // Permission is in place but nothing is stored yet and the quiet check is slow: tapping Allow does the same job.
    await page.addInitScript(() => { navigator.permissions.query = () => Promise.resolve({ state: 'prompt' }); });
    await page.goto(base + '/index.html');
    await page.tap('#allowBtn');
    await page.waitForURL('**/viewer.html', { timeout: 10000 });
  } finally { await context.close(); }
});

test('tablet: a tablet that cannot work out its position still gets the sky view, with an area from the network', { skip }, async () => {
  const { page, context } = await tablet({ geo: { error: 2 } });
  try {
    await page.addInitScript(() => { navigator.permissions.query = () => Promise.resolve({ state: 'prompt' }); });
    await page.goto(base + '/index.html');
    await page.tap('#allowBtn');
    await page.waitForFunction(() => /Could not read your position/.test(document.querySelector('#msg').textContent), null, { timeout: 5000 });
    await page.waitForURL('**/viewer.html', { timeout: 10000 });
  } finally { await context.close(); }
});

test('tablet: saying no to location asks for coordinates instead, and does not move on', { skip }, async () => {
  const { page, context } = await tablet({ geo: { error: 1 } });
  try {
    await page.addInitScript(() => { navigator.permissions.query = () => Promise.resolve({ state: 'prompt' }); });
    await page.goto(base + '/index.html');
    await page.tap('#allowBtn');
    await page.waitForSelector('#manualForm:not([hidden])');
    await page.waitForTimeout(1500);
    assert.match(page.url(), /index\.html$/, 'a refusal is respected');
  } finally { await context.close(); }
});

test('tablet: after the app is installed the home page stops offering to install it, also on later visits', { skip }, async () => {
  const { page, context } = await tablet({ permission: true, storage: { 'fg.loc': JSON.stringify({ lat: 17.4435, lon: 78.3772 }) } });
  try {
    await page.goto(base + '/index.html');
    assert.equal(await page.isVisible('#installCard'), true, 'offered before it is installed');
    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
    assert.equal(await page.isVisible('#installCard'), false, 'gone as soon as it is installed');
    assert.equal(await page.isVisible('#menuInstall'), false, 'and from the menu');
    assert.equal(await page.evaluate(() => localStorage.getItem('fg.installed')), '1');
    await page.reload();
    assert.equal(await page.isVisible('#installCard'), false, 'still gone on the next visit in a browser tab');
    // Chrome offers the install prompt only while the app is not installed, so an offer means it was removed.
    await page.evaluate(() => { const e = new Event('beforeinstallprompt'); e.prompt = () => {}; e.userChoice = Promise.resolve({}); window.dispatchEvent(e); });
    assert.equal(await page.isVisible('#installCard'), true, 'offered again after it was uninstalled');
    assert.equal(await page.evaluate(() => localStorage.getItem('fg.installed')), '0');
  } finally { await context.close(); }
});

test('tablet: Settings has no compass card, because there is nothing to allow', { skip }, async () => {
  const { page, context } = await tablet({ permission: true });
  try {
    await page.goto(base + '/settings.html');
    assert.equal(await page.isVisible('#compassBtn'), false);
    assert.doesNotMatch(await page.innerText('main'), /Compass/);
    assert.equal(await page.isVisible('#geoBtn'), true, 'location is still there');
  } finally { await context.close(); }
});

// The sensors belong to the device. A tablet's natural position is sideways, and the installed app may be held in portrait,
// so the top of the screen is not the device's own top. Chrome reports where the screen is turned in screen.orientation.angle.
async function sensorAt(page, alpha, beta, gamma, times = 40) {
  for (let i = 0; i < times; i++) {
    await page.evaluate(([a, b, g]) => { const e = new Event('deviceorientationabsolute'); e.alpha = a; e.beta = b; e.gamma = g; e.absolute = true; window.dispatchEvent(e); }, [alpha, beta, gamma]);
  }
}

test('tablet: lying flat, the radar north follows the top of the screen whichever way the screen is turned', { skip }, async () => {
  const saved = { 'fg.loc': JSON.stringify({ lat: 17.4435, lon: 78.3772 }) };
  const heading = 100; // the top of the screen points here
  // Angle 0 (natural position): the device's own top is the top of the screen. Angle 90: the device x axis is. 270: minus x.
  const cases = [[0, (360 - heading) % 360], [90, (90 - heading + 360) % 360], [270, (270 - heading + 360) % 360], [180, (360 - (heading + 180) % 360) % 360]];
  for (const [angle, alpha] of cases) {
    const { page, context } = await tablet({ permission: true, storage: saved });
    try {
      await page.addInitScript((angle) => { Object.defineProperty(screen.orientation, 'angle', { get: () => angle, configurable: true }); }, angle);
      await page.goto(base + '/viewer.html?fgtest=1');
      await page.evaluate(() => { __fg.state.declination = 0; __fg.state.ori.declination = 0; __fg.state.arOffset = { h: 0, p: 0 }; });
      await sensorAt(page, alpha, 0, 0);
      const h = await page.evaluate(() => __fg.state.heading);
      assert.ok(Math.abs(((h - heading + 540) % 360) - 180) < 1, 'screen angle ' + angle + ': the radar faces ' + heading + ' but shows ' + h.toFixed(1));
    } finally { await context.close(); }
  }
});

test('tablet: raising it upright does not move north', { skip }, async () => {
  const { page, context } = await tablet({ permission: true, storage: { 'fg.loc': JSON.stringify({ lat: 17.4435, lon: 78.3772 }) } });
  try {
    await page.addInitScript(() => { Object.defineProperty(screen.orientation, 'angle', { get: () => 90, configurable: true }); });
    await page.goto(base + '/viewer.html?fgtest=1');
    await page.evaluate(() => { __fg.state.declination = 0; __fg.state.ori.declination = 0; __fg.state.arOffset = { h: 0, p: 0 }; });
    const heading = 250, alpha = (90 - heading + 360) % 360;
    for (const tilt of [0, 20, 45, 70, 90]) {
      await sensorAt(page, alpha, 0, -tilt, 40);
      const h = await page.evaluate(() => __fg.state.heading);
      assert.ok(Math.abs(((h - heading + 540) % 360) - 180) < 1.5, 'tilt ' + tilt + ': ' + h.toFixed(1));
    }
  } finally { await context.close(); }
});

test('tablet: turning the screen between portrait and landscape is followed at once, and east stays east', { skip }, async () => {
  const { page, context } = await tablet({ permission: true, storage: { 'fg.loc': JSON.stringify({ lat: 17.4435, lon: 78.3772 }) } });
  try {
    await page.addInitScript(() => { window.__angle = 0; Object.defineProperty(Object.getPrototypeOf(screen.orientation), 'angle', { get: () => window.__angle, configurable: true }); });
    await page.goto(base + '/viewer.html?fgtest=1');
    await page.evaluate(() => { __fg.state.declination = 0; __fg.state.ori.declination = 0; __fg.state.arOffset = { h: 0, p: 0 }; });
    const near = (a, b, tol = 1) => Math.abs(((a - b + 540) % 360) - 180) <= tol;
    // The tablet lies flat and its screen top points east (90). Then it is turned a quarter, so the screen top is a
    // different edge of the device. The user has not moved: the screen top now points where the device's top-left edge does.
    await sensorAt(page, (360 - 90) % 360, 0, 0, 60); // angle 0: device top = screen top = east
    assert.ok(near(await page.evaluate(() => __fg.state.heading), 90), 'portrait: east');
    // Turned by 90 (a quarter), the screen top is the device x axis. A device whose x axis points south reads alpha 90 - 180.
    await page.evaluate(() => { window.__angle = 90; screen.orientation.dispatchEvent(new Event('change')); });
    await sensorAt(page, (90 - 180 + 360) % 360, 0, 0, 1); // ONE reading
    assert.ok(near(await page.evaluate(() => __fg.state.heading), 180), 'after the turn the first reading is already right: ' + await page.evaluate(() => __fg.state.heading));
    // And back: east is east again straight away.
    await page.evaluate(() => { window.__angle = 0; screen.orientation.dispatchEvent(new Event('change')); });
    await sensorAt(page, (360 - 90) % 360, 0, 0, 1);
    assert.ok(near(await page.evaluate(() => __fg.state.heading), 90), 'back in portrait: east again');
  } finally { await context.close(); }
});

test('tablet: the gear menu in the sky view starts the browser install, and the item goes once installed or in the installed app', { skip }, async () => {
  const saved = { 'fg.loc': JSON.stringify({ lat: 17.4435, lon: 78.3772 }) };
  const { page, context } = await tablet({ permission: true, storage: saved });
  try {
    await page.goto(base + '/viewer.html?fgtest=1');
    await page.tap('#gearBtn');
    assert.equal(await page.isVisible('#gearInstall'), true, 'offered');
    await page.keyboard.press('Escape');
    // Chrome offers the install: the item starts it.
    await page.evaluate(() => { window.__prompted = 0; const e = new Event('beforeinstallprompt'); e.prompt = () => { window.__prompted++; }; e.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(e); });
    await page.tap('#gearBtn');
    await page.tap('#gearInstall');
    assert.equal(await page.evaluate(() => window.__prompted), 1, 'the browser\'s own install prompt was started');
    assert.equal(await page.isVisible('#gearList'), false);
    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
    await page.tap('#gearBtn');
    assert.equal(await page.isVisible('#gearInstall'), false, 'gone once installed');
    assert.equal(await page.evaluate(() => localStorage.getItem('fg.installed')), '1');
  } finally { await context.close(); }
  // The installed app itself (display mode standalone) never shows it.
  const b = await tablet({ permission: true, storage: saved });
  try {
    await b.page.addInitScript(() => { const mm = window.matchMedia.bind(window); window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : mm(q)); });
    await b.page.goto(base + '/viewer.html?fgtest=1');
    await b.page.tap('#gearBtn');
    assert.equal(await b.page.isVisible('#gearInstall'), false, 'not shown inside the installed app');
  } finally { await b.context.close(); }
});
