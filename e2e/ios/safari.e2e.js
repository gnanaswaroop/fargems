'use strict';
// A Safari (WebKit) test with an iPhone profile. It is not a real iPhone: there is no real compass, and Safari on a
// desktop machine does not have the iPhone-only motion permission. So this test adds the two iPhone-only things the app
// depends on, the way Safari on iOS provides them, and checks the app does the right thing with them:
//   - DeviceOrientationEvent.requestPermission(), which only works when called inside a tap, and
//   - webkitCompassHeading on orientation events (a heading in degrees clockwise from magnetic north).
// What it does cover for real: WebKit's engine and layout at an iPhone screen size, the iPhone user agent (so the iPhone
// install steps show), touch taps, geolocation, the camera call, and the app's own logic for the iPhone paths.
// It does not replace trying the app on a real iPhone.
//
// Run: npm run test:ios     (needs: cd e2e/ios && npm ci && npx playwright install webkit)
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

let playwright = null;
try { playwright = require('playwright'); } catch { /* not installed: the tests skip */ }
const skip = playwright ? false : 'Playwright is not installed (run: cd e2e/ios && npm ci && npx playwright install webkit)';

const ROOT = path.join(__dirname, '..', '..');
const D = require('../../lib/declination.js');
const HITEC = { latitude: 17.4435, longitude: 78.3772 }; // HITEC City, Hyderabad
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://localhost:' + server.address().port; // localhost counts as a secure context
  browser = await playwright.webkit.launch();
});

test.after(async () => {
  if (skip) return;
  if (browser) await browser.close();
  if (server) server.close();
});

// A fresh iPhone page. `answer` is what the iPhone motion prompt will say when the visitor is asked.
// `quiet`: the browser already allows location for the site (so the page can fetch it without asking). By default the
// browser reports "ask", like a first visit, even though the test browser will answer when asked.
async function iphone({ storage = {}, answer = 'granted', quiet = false } = {}) {
  const context = await browser.newContext({
    ...playwright.devices['iPhone 14'], serviceWorkers: 'block',
    geolocation: HITEC, permissions: ['geolocation'],
  });
  await context.addInitScript(({ storage, answer, quiet }) => {
    for (const [k, v] of Object.entries(storage)) { try { if (!localStorage.getItem('__seeded')) localStorage.setItem(k, v); } catch { /* blocked */ } }
    try { localStorage.setItem('__seeded', '1'); } catch { /* blocked */ }
    // What Safari on iOS adds: a motion permission that answers only to a tap. It records when it was asked.
    window.__ios = { asked: [], answer, order: [] };
    DeviceOrientationEvent.requestPermission = () => {
      window.__ios.asked.push(Date.now()); window.__ios.order.push('motion');
      return Promise.resolve(window.__ios.answer);
    };
    const get = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    navigator.geolocation.getCurrentPosition = (...a) => { window.__ios.order.push('location'); return get(...a); };
    if (!quiet && navigator.permissions) {
      const q = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = (d) => (d && d.name === 'geolocation' ? Promise.resolve({ state: 'prompt', addEventListener() {} }) : q(d));
    }
    // A camera without a camera. This test browser has no media stack at all (no mediaDevices, no streams), so the page gets
    // a stand-in stream and a video element that remembers what it was given. The AR view only needs those two things.
    const fake = { getTracks: () => [{ stop() {} }] };
    if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true });
    navigator.mediaDevices.getUserMedia = async () => fake;
    Object.defineProperty(HTMLVideoElement.prototype, 'srcObject', { configurable: true, get() { return this.__src || null; }, set(v) { this.__src = v; } });
    HTMLVideoElement.prototype.play = () => Promise.resolve();
    // Every message the app shows in its toast, in order, so a message that is soon replaced can still be checked.
    window.__toasts = [];
    document.addEventListener('DOMContentLoaded', () => {
      const t = document.querySelector('#toast');
      if (t) new MutationObserver(() => { if (t.textContent) window.__toasts.push(t.textContent); }).observe(t, { childList: true, characterData: true, subtree: true });
    });
  }, { storage, answer, quiet });
  const page = await context.newPage();
  const errors = [];
  // The public data services refuse a page on localhost (no CORS), which is expected here and is not an app error.
  page.on('pageerror', (e) => { if (!/access control checks|Fetch API cannot load|Load failed/.test(String(e))) errors.push(String(e)); });
  return { page, context, errors };
}

// Pretend to be the compass: the phone lies flat (beta 0), its top pointing at a magnetic heading.
async function heading(page, magnetic, times = 40, beta = 0) {
  for (let i = 0; i < times; i++) {
    await page.evaluate(([h, b]) => { const e = new Event('deviceorientation'); e.webkitCompassHeading = h; e.alpha = 0; e.beta = b; e.gamma = 0; e.absolute = false; window.dispatchEvent(e); }, [magnetic, beta]);
    await sleep(15);
  }
}
const SAVED = { 'fg.loc': JSON.stringify({ lat: HITEC.latitude, lon: HITEC.longitude }) };

test('the iPhone profile really is an iPhone in Safari', { skip }, async () => {
  const { page, context } = await iphone();
  try {
    await page.goto(base + '/index.html');
    const info = await page.evaluate(() => ({ ua: navigator.userAgent, touch: navigator.maxTouchPoints, motion: typeof DeviceOrientationEvent.requestPermission, w: innerWidth }));
    assert.match(info.ua, /iPhone/);
    assert.equal(info.motion, 'function', 'the iPhone motion permission is present');
    assert.ok(info.w <= 430, 'a screen the size of an iPhone');
  } finally { await context.close(); }
});

test('landing: the motion prompt is started inside the tap, before location, and the page becomes ready', { skip }, async () => {
  const { page, context, errors } = await iphone();
  try {
    await page.goto(base + '/index.html');
    assert.equal(await page.isVisible('#permsCard'), true);
    await page.tap('#allowBtn');
    await page.waitForFunction(() => localStorage.getItem('fg.loc'), null, { timeout: 15000 });
    const order = await page.evaluate(() => window.__ios.order);
    assert.deepEqual(order.slice(0, 2), ['motion', 'location'], 'iOS rejects the motion request after any waiting, so it must come first, inside the tap');
    assert.equal(await page.evaluate(() => localStorage.getItem('fg.compass')), 'granted');
    const loc = JSON.parse(await page.evaluate(() => localStorage.getItem('fg.loc')));
    assert.ok(Math.abs(loc.lat - HITEC.latitude) < 0.01 && Math.abs(loc.lon - HITEC.longitude) < 0.01);
    assert.equal(await page.isVisible('#permsCard'), false, 'the permission card goes once permissions exist');
    assert.equal(await page.isVisible('#openLink'), true, 'the launch button takes its place');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('landing: refusing motion access still lets the visitor in, and the refusal is remembered', { skip }, async () => {
  const { page, context } = await iphone({ answer: 'denied' });
  try {
    await page.goto(base + '/index.html');
    await page.tap('#allowBtn');
    await page.waitForFunction(() => localStorage.getItem('fg.loc'), null, { timeout: 15000 });
    assert.equal(await page.evaluate(() => localStorage.getItem('fg.compass')), 'denied');
    assert.equal(await page.isVisible('#openLink'), true);
  } finally { await context.close(); }
});

test('landing: when Safari already allows location for the site, the page goes straight to ready without asking again', { skip }, async () => {
  const { page, context } = await iphone({ quiet: true });
  try {
    await page.goto(base + '/index.html');
    await page.waitForFunction(() => localStorage.getItem('fg.loc'), null, { timeout: 15000 });
    assert.equal(await page.isVisible('#permsCard'), false, 'no permission card');
    assert.equal(await page.isVisible('#openLink'), true, 'the launch button is there');
    assert.deepEqual(await page.evaluate(() => window.__ios.asked), [], 'the motion prompt waits for a tap');
  } finally { await context.close(); }
});

test('landing: on an iPhone the Install app button shows the Share, Add to Home Screen steps', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await page.goto(base + '/index.html');
    assert.equal(await page.isVisible('#installBtn'), true);
    assert.match(await page.textContent('#installText'), /Share[\s\S]*Add to Home Screen/);
    await page.tap('#installBtn');
    assert.match(await page.getAttribute('#installText', 'class'), /flash/, 'tapping draws the eye to the steps');
  } finally { await context.close(); }
});

test('sky view: with motion allowed earlier, the iPhone heading (webkitCompassHeading) becomes the true heading', { skip }, async () => {
  const { page, context, errors } = await iphone({ storage: { ...SAVED, 'fg.compass': 'granted' } });
  try {
    await page.goto(base + '/viewer.html');
    await heading(page, 90);
    const text = await page.textContent('#facing');
    const shown = Number(text.match(/(\d+)° \(true\)/)[1]);
    const expected = D.trueHeading(90, D.declination(HITEC.latitude, HITEC.longitude, new Date()));
    assert.ok(Math.abs(shown - expected) <= 3, `shows ${shown}°, expected about ${expected.toFixed(1)}° (a magnetic 90° plus the local declination)`);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('sky view: an iPhone with nothing stored does not turn the compass on by itself, because that needs a tap', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await page.goto(base + '/viewer.html');
    await heading(page, 200, 15);
    assert.equal(await page.isVisible('#facing'), false, 'no heading shown: the compass is off');
    assert.deepEqual(await page.evaluate(() => window.__ios.asked), [], 'the motion prompt is not shown on its own');
  } finally { await context.close(); }
});

test('AR on an iPhone: the AR button asks for motion inside the tap, opens the camera view, and it stays open', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await page.goto(base + '/viewer.html');
    await page.tap('#arBtn');
    await page.waitForFunction(() => !document.querySelector('#ar').hidden, null, { timeout: 15000 });
    assert.equal(await page.evaluate(() => window.__ios.asked.length), 1, 'asked once, by the tap');
    assert.equal(await page.evaluate(() => localStorage.getItem('fg.compass')), 'granted');
    await heading(page, 45, 30);
    await sleep(2500); // long enough for the tilt rule to have closed an automatic view; a view opened by hand stays
    assert.equal(await page.evaluate(() => !document.querySelector('#ar').hidden), true, 'still open with the phone flat');
    assert.equal(await page.evaluate(() => !!document.querySelector('#arVideo').srcObject), true, 'the camera picture is running');
    assert.match(await page.textContent('#facing'), /Facing/, 'the compass is on now');
    await page.tap('#arClose');
    assert.equal(await page.evaluate(() => document.querySelector('#ar').hidden), true, 'the close button closes it');
  } finally { await context.close(); }
});

test('AR on an iPhone: refusing motion access is explained and remembered', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED, answer: 'denied' });
  try {
    await page.goto(base + '/viewer.html');
    await page.tap('#arBtn');
    await page.waitForFunction(() => window.__toasts.some((t) => /Compass permission is needed for AR/.test(t)), null, { timeout: 10000 });
    assert.equal(await page.evaluate(() => localStorage.getItem('fg.compass')), 'denied', 'the refusal is remembered');
    assert.equal(await page.evaluate(() => window.__ios.asked.length), 1, 'asked once');
  } finally { await context.close(); }
});

test('sky view: text the visitor selected stays selected while the page refreshes itself', { skip }, async () => {
  const { page, context } = await iphone({ storage: { ...SAVED, 'fg.compass': 'granted' } });
  try {
    await page.goto(base + '/viewer.html');
    await sleep(800);
    const select = (sel) => page.evaluate((q) => { const el = document.querySelector(q); const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return String(s); }, sel);
    for (const sel of ['#status', '#detail']) {
      const before = await select(sel);
      assert.ok(before.length > 5, `something to select in ${sel}`);
      await sleep(4500); // the page rewrites its status and cards every 2 seconds
      assert.equal(await page.evaluate(() => String(getSelection())), before, `${sel}: the selection survived two refreshes`);
    }
  } finally { await context.close(); }
});

test('sky view: the radar controls sit under the radar and do not cover it', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await page.goto(base + '/viewer.html');
    await sleep(500);
    const r = await page.evaluate(() => { const c = document.querySelector('#sky').getBoundingClientRect(), z = document.querySelector('.zoombar').getBoundingClientRect(); return { skyBottom: c.bottom, barTop: z.top, barBottom: z.bottom, w: innerWidth, barRight: z.right }; });
    assert.ok(r.barTop >= r.skyBottom - 1, `controls start at ${r.barTop}px, below the radar that ends at ${r.skyBottom}px`);
    assert.ok(r.barRight <= r.w + 1, 'and they fit the screen');
    assert.ok(r.barTop - r.skyBottom < 40, 'and are close to it, not far away');
  } finally { await context.close(); }
});

test('sky view: the nearby list has an icon and a type for each object, and its text can be selected', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await page.goto(base + '/viewer.html');
    await page.tap('#tabNearby');
    await page.waitForSelector('.nearby-row');
    const rows = await page.evaluate(() => [...document.querySelectorAll('.nearby-row')].slice(0, 12).map((r) => ({ type: r.dataset.type, tag: r.querySelector('.tag').textContent, svg: !!r.querySelector('.ico svg'), name: r.querySelector('.nm').textContent, select: getComputedStyle(r).userSelect || getComputedStyle(r).webkitUserSelect })));
    assert.ok(rows.length > 3, 'there are objects to list');
    for (const r of rows) { assert.ok(r.svg, `${r.name} has an icon`); assert.ok(r.tag, `${r.name} has a type`); assert.equal(r.select, 'text', `${r.name}: selectable`); }
    assert.ok(rows.some((r) => r.type === 'planet') || rows.some((r) => r.type === 'moon' || r.type === 'sun'), 'the Sun, Moon or planets are in the list with their own icons');
    // tapping a row still opens the object on the radar
    await page.tap('.nearby-row');
    assert.equal(await page.evaluate(() => document.querySelector('#tabRadar').getAttribute('aria-selected')), 'true');
  } finally { await context.close(); }
});

test('every page fits an iPhone screen with no sideways scrolling', { skip }, async () => {
  const { page, context } = await iphone({ storage: { ...SAVED, 'fg.compass': 'granted' } });
  try {
    for (const p of ['index.html', 'viewer.html', 'settings.html', 'about.html']) {
      await page.goto(base + '/' + p);
      await sleep(500);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(over <= 1, `${p} is ${over}px wider than the screen`);
    }
  } finally { await context.close(); }
});

test('the pages ask for the full screen and the notch area, as an installed iPhone app needs', () => {
  for (const p of ['index.html', 'viewer.html']) {
    const html = fs.readFileSync(path.join(ROOT, p), 'utf8');
    assert.match(html, /viewport-fit=cover/, `${p}: viewport-fit=cover`);
  }
  const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(index, /apple-mobile-web-app-capable/);
  assert.match(index, /apple-touch-icon/);
});
