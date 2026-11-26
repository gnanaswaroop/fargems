'use strict';
// An Android tablet in Chrome's engine (Chromium): the Galaxy Tab S4 profile (screen size, touch, Android user agent).
// It is not a real tablet: there is no real GPS or compass, so the tests give the page a position, a refusal or an
// error the way Chrome on Android does, and fire the install events the way Chrome does. It checks that the page
// does the right thing with them. It does not replace trying the app on a real tablet.
//
// Run: npm run test:tablet     (needs: cd e2e/ios && npm ci && npx playwright install chromium)
const test = require('node:test');
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
