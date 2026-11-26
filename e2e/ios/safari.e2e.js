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

// What Safari on iPadOS 13 and later sends: it says it is a Mac, and the touch screen is the only hint.
const DESKTOP_SAFARI_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

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
async function iphone({ storage = {}, answer = 'granted', quiet = false, device = 'iPhone 14', desktopUA = false } = {}) {
  const context = await browser.newContext({
    ...playwright.devices[device], ...(desktopUA ? { userAgent: DESKTOP_SAFARI_UA } : {}), serviceWorkers: 'block',
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

test('landing: the motion prompt is started inside the tap, before location, and the sky view opens', { skip }, async () => {
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
    assert.deepEqual(errors, []);
    await page.waitForURL('**/viewer.html', { timeout: 10000 }); // permission given: straight to the sky view
  } finally { await context.close(); }
});

test('iPad in landscape: the home page and the sky view fit the screen with no vertical scroll, and the radar is not cut off', { skip }, async () => {
  const context = await browser.newContext({ ...playwright.devices['iPad Pro 11 landscape'], serviceWorkers: 'block', geolocation: HITEC, permissions: ['geolocation'] });
  try {
    const page = await context.newPage();
    await page.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
    const fit = () => page.evaluate(() => ({ h: document.documentElement.scrollHeight, vh: innerHeight, w: document.documentElement.scrollWidth, vw: innerWidth }));
    await page.goto(base + '/index.html');
    let m = await fit();
    assert.ok(m.h <= m.vh && m.w <= m.vw, `home fits ${JSON.stringify(m)}`);
    const cols = await page.evaluate(() => { const a = document.querySelector('.intro').getBoundingClientRect(), b = document.querySelector('.actions').getBoundingClientRect(); return { introRight: a.right, actionsLeft: b.left }; });
    assert.ok(cols.actionsLeft >= cols.introRight, 'two columns side by side');
    await page.evaluate(() => localStorage.setItem('fg.loc', JSON.stringify({ lat: 17.4435, lon: 78.3772 })));
    await page.goto(base + '/viewer.html');
    await page.waitForTimeout(1200);
    m = await fit();
    assert.ok(m.h <= m.vh && m.w <= m.vw, `sky view fits ${JSON.stringify(m)}`);
    const box = await page.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); return { sky: r('#sky'), side: r('.side'), nearby: r('#pageNearby') }; });
    assert.ok(box.side.left >= box.sky.right - 1, 'the radar and the column of details are side by side');
    assert.ok(box.nearby.left >= box.side.left - 1 && box.nearby.right <= box.side.right + 1, 'the nearby list is in that column, under the details');
    assert.ok(box.nearby.height > 200 || (await page.evaluate(() => document.querySelectorAll('.nearby-row').length)) < 4, 'and it uses the height left, so the column has no big empty space');
    assert.ok(box.sky.width > 400, 'the radar uses the space');
    assert.equal(await page.isVisible('.tabs'), false, 'no tabs when both lists are shown');
  } finally { await context.close(); }
});

// Every iPad profile Playwright knows (sizes, touch, the iPad user agent), in both orientations, on the real Safari engine.
const IPADS = ['iPad (gen 5)', 'iPad (gen 6)', 'iPad (gen 7)', 'iPad (gen 11)', 'iPad Mini', 'iPad Pro 11'].flatMap((n) => [n, n + ' landscape']);
for (const device of IPADS) {
  test(`${device}: the iPad user agent, no sideways scroll on any page, and the layout fits the orientation`, { skip }, async () => {
    const { page, context, errors } = await iphone({ device, storage: SAVED });
    try {
      assert.match(await page.evaluate(() => navigator.userAgent), /iPad/);
      const landscape = /landscape/.test(device);
      for (const f of ['index.html', 'about.html', 'settings.html', 'viewer.html']) {
        await page.goto(`${base}/${f}`);
        await page.waitForTimeout(300);
        const m = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, vw: innerWidth, h: document.documentElement.scrollHeight, vh: innerHeight }));
        assert.ok(m.w <= m.vw, `${f} scrolls sideways ${JSON.stringify(m)}`);
        if (landscape && (f === 'index.html' || f === 'viewer.html')) assert.ok(m.h <= m.vh, `${f} scrolls up and down in landscape ${JSON.stringify(m)}`);
        if (f === 'viewer.html') assert.equal(await page.isVisible('.tabs'), !landscape, landscape ? 'both lists shown, no tabs' : 'tabs in portrait');
      }
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}

test('iPad: tapping Allow asks for motion inside the tap and then opens the sky view', { skip }, async () => {
  const { page, context } = await iphone({ device: 'iPad Pro 11 landscape' });
  try {
    await page.goto(base + '/index.html');
    await page.tap('#allowBtn');
    await page.waitForFunction(() => localStorage.getItem('fg.loc'), null, { timeout: 15000 });
    assert.deepEqual((await page.evaluate(() => window.__ios.order)).slice(0, 2), ['motion', 'location']);
    assert.equal(await page.evaluate(() => localStorage.getItem('fg.compass')), 'granted');
    await page.waitForURL('**/viewer.html', { timeout: 15000 });
  } finally { await context.close(); }
});

test('iPadOS Safari, which says it is a Mac, still gets the Add to Home Screen steps', { skip }, async () => {
  const { page, context } = await iphone({ device: 'iPad Pro 11', desktopUA: true });
  try {
    // Safari on an iPad reports a Mac platform with a touch screen; this test browser needs those two told to it.
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
      Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 });
    });
    await page.goto(base + '/index.html');
    assert.doesNotMatch(await page.evaluate(() => navigator.userAgent), /iPad|iPhone/, 'the page sees a Mac user agent');
    assert.ok(await page.evaluate(() => navigator.maxTouchPoints > 1), 'with a touch screen');
    await page.waitForFunction(() => /Share/.test(document.querySelector('#installText').textContent), null, { timeout: 5000 });
  } finally { await context.close(); }
});

// Objects for the list and the radar without needing the sky libraries or the network.
const FAKE_SKY = `(() => {
  const { state, renderNearby, renderDetail } = window.__fg;
  const mk = (id, kind, name, az, el, distKm, extra) => Object.assign({ id, kind, name, az, el, distKm, range: distKm }, extra || {});
  state.objs = [
    mk('air:a1', 'air', 'AIC144', 200, 31, 12, { ac: { type: 'A20N', gs: 400, track: 90, vr: 0, id: 'a1' }, altFt: 12000 }),
    mk('sat:25544', 'sat', 'ISS (ZARYA)', 90, 40, 420, { altKm: 420, speed: 7.6, visible: true, norad: 25544 }),
    mk('body:Moon', 'body', 'Moon', 68, 49, 384400, { mag: null, phase: 0.98, color: '#e6ecf5' }),
    mk('star:Vega', 'star', 'Vega', 10, 60, null, {}),
  ];
  state.byId = new Map(state.objs.map((o) => [o.id, o]));
  renderNearby(); renderDetail(); state.dirty = true;
})()`;

test('viewer: the gear opens Settings and Help, and Escape closes it', { skip }, async () => {
  const { page, context, errors } = await iphone({ storage: SAVED });
  try {
    await page.goto(base + '/viewer.html');
    assert.equal(await page.isVisible('#gearList'), false);
    await page.tap('#gearBtn');
    assert.equal(await page.isVisible('#gearList'), true);
    assert.deepEqual(await page.$$eval('#gearList a', (as) => as.map((a) => [a.textContent, a.getAttribute('href')])), [['Settings', 'settings.html'], ['Help', 'about.html#faq']]);
    await page.keyboard.press('Escape');
    assert.equal(await page.isVisible('#gearList'), false);
    await page.tap('#gearBtn');
    await page.tap('#gearList a[href="about.html#faq"]');
    await page.waitForURL('**/about.html#faq');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('viewer: a pinned object jumps to the top of the nearby list, stays pinned, and a tap on its star does not open it', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    // The sky libraries would recompute the objects every second and replace the ones this test sets up.
    await context.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
    await page.goto(base + '/viewer.html?fgtest=1');
    await page.evaluate(FAKE_SKY);
    const names = () => page.$$eval('.nearby-row .nm', (els) => els.map((e) => e.textContent.replace(/[★☆]/g, '').trim()));
    assert.deepEqual(await names(), ['AIC144', 'ISS (ZARYA)', 'Moon', 'Vega'], 'nearest first');
    await page.click('#tabNearby');
    await page.click('.nearby-row[data-id="star:Vega"] .pin');
    assert.equal((await names())[0], 'Vega', 'pinned to the top');
    assert.equal(await page.getAttribute('.nearby-row[data-id="star:Vega"] .pin', 'aria-pressed'), 'true');
    assert.equal(await page.evaluate(() => __fg.state.sel), null, 'the star did not select the row');
    assert.equal(await page.evaluate(() => localStorage.getItem('fg.pins')), '["star:Vega"]');
    await page.click('.nearby-row[data-id="body:Moon"] .pin');
    assert.deepEqual((await names()).slice(0, 2), ['Moon', 'Vega'], 'the newest pin first');
    await page.click('.nearby-row[data-id="star:Vega"] .pin');
    assert.equal(await page.evaluate(() => localStorage.getItem('fg.pins')), '["body:Moon"]', 'unpinned');
  } finally { await context.close(); }
});

test('viewer: the detail card shows the nearest flight or satellite, can pin it, and can share it', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    // The sky libraries would recompute the objects every second and replace the ones this test sets up.
    await context.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
    await page.goto(base + '/viewer.html?fgtest=1');
    await page.evaluate(() => {
      window.__copied = [];
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.__copied.push(t); return Promise.resolve(); } }, configurable: true });
    });
    await page.evaluate(FAKE_SKY);
    const card = await page.textContent('#detail');
    assert.match(card, /AIC144/);
    assert.match(card, /Nearest flight/, 'nothing picked: the nearest flight');
    assert.ok((await page.$$('#detail dt')).length <= 6, 'a short card');
    await page.click('#detail [data-pin]');
    assert.equal(await page.evaluate(() => localStorage.getItem('fg.pins')), '["air:a1"]');
    assert.match(await page.textContent('#detail [data-pin]'), /Pinned/);
    await page.click('#detail [data-share]');
    await page.waitForFunction(() => window.__copied.length === 1);
    const text = await page.evaluate(() => window.__copied[0]);
    assert.match(text, /^AIC144 \(aircraft\) is 31° above the horizon in the SSW \(200°\) right now\./);
    assert.match(text, /Airbus_A320neo_family/);
    assert.match(text, /https?:\/\/localhost:\d+\/$/, 'ends with the address of this site');
    assert.doesNotMatch(text, /17\.4|78\.3/, 'no coordinates');
  } finally { await context.close(); }
});

test('viewer: a long name stays inside the radar circle, also for the selected object near the rim', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    // The sky libraries would recompute the objects every second and replace the ones this test sets up.
    await context.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
    await page.goto(base + '/viewer.html?fgtest=1');
    await page.evaluate(() => {
      window.__texts = [];
      const orig = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (t, x, y) { window.__texts.push({ t, x, y, a: this.textAlign, w: this.measureText(t).width }); return orig.apply(this, arguments); };
    });
    for (const az of [90, 270, 0, 180, 45]) {
      await page.evaluate((az) => {
        const o = { id: 'sat:9', kind: 'sat', name: 'STARLINK-ABSURDLY-LONG-NAME-FOR-A-SATELLITE-12345', az, el: 2, distKm: 900, range: 900, altKm: 500, speed: 7, visible: true, norad: 9 };
        const { state, draw } = window.__fg;
        state.objs = [o]; state.byId = new Map([[o.id, o]]); state.sel = o.id; state.compass = false; state.rot = 0; state.flip = false;
        window.__texts = []; draw();
      }, az);
      const r = await page.evaluate(() => {
        const W = Math.round(document.querySelector('#sky').clientWidth), R = (W / 2 - 26) * __fg.state.view.zoom, c = W / 2;
        const t = window.__texts.find((x) => x.t.includes('STARLINK'));
        if (!t) return { missing: true };
        const x0 = t.a === 'left' ? t.x : t.a === 'right' ? t.x - t.w : t.x - t.w / 2, x1 = x0 + t.w;
        const corners = [[x0, t.y - 10], [x1, t.y - 10], [x0, t.y + 3], [x1, t.y + 3]];
        return { W, worst: Math.max(...corners.map(([x, y]) => Math.hypot(x - c, y - c))) - R, x0, x1 };
      });
      assert.ok(!r.missing, `the selected name is drawn at ${az}°`);
      assert.ok(r.worst <= 1 && r.x0 >= 0 && r.x1 <= r.W, `az ${az}: the name is ${r.worst.toFixed(1)} px outside the circle (${JSON.stringify(r)})`);
    }
  } finally { await context.close(); }
});

test('viewer: opened with no location and no permission, the sky is shown for the city guessed from the network, and the guess is not saved', { skip }, async () => {
  const { page, context } = await iphone({ storage: {} });
  try {
    await context.route('**/config.js*', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.FARGEMS_CONFIG = { aircraftProxy: "https://relay.test/aircraft", build: "" };' }));
    await context.route('https://relay.test/**', (r) => {
      const u = new URL(r.request().url());
      const h = { 'Access-Control-Allow-Origin': '*' };
      if (u.pathname === '/locate') return r.fulfill({ status: 200, headers: h, contentType: 'application/json', body: JSON.stringify({ lat: 17.44, lon: 78.38, city: 'Hyderabad', region: 'Telangana', country: 'IN' }) });
      return r.fulfill({ status: 503, headers: h, contentType: 'application/json', body: '{}' });
    });
    await page.goto(base + '/viewer.html?fgtest=1');
    await page.waitForSelector('#approxNote:not([hidden])', { timeout: 10000 });
    assert.match(await page.textContent('#approxNote'), /about Hyderabad, IN, a guess from your network/);
    assert.equal(await page.getAttribute('#approxNote a', 'href'), 'settings.html');
    assert.equal(await page.isVisible('#noLocation'), false, 'no need to ask for a location');
    assert.equal(await page.evaluate(() => localStorage.getItem('fg.loc')), null, 'the guess is not saved as the visitor\'s location');
    assert.deepEqual(await page.evaluate(() => [__fg.state.loc.lat, __fg.state.loc.lon]), [17.44, 78.38]);
  } finally { await context.close(); }
});

test('viewer: when the network guess is not available, the card asks for a location as before', { skip }, async () => {
  const { page, context } = await iphone({ storage: {} });
  try {
    await context.route('**/config.js*', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.FARGEMS_CONFIG = { aircraftProxy: "https://relay.test/aircraft", build: "" };' }));
    await context.route('https://relay.test/**', (r) => r.fulfill({ status: 404, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: '{"error":"location unknown"}' }));
    await page.goto(base + '/viewer.html?fgtest=1');
    await page.waitForTimeout(1500);
    assert.equal(await page.isVisible('#noLocation'), true);
    assert.equal(await page.isVisible('#approxNote'), false);
  } finally { await context.close(); }
});

test('landing: refusing motion access still lets the visitor in, and the refusal is remembered', { skip }, async () => {
  const { page, context } = await iphone({ answer: 'denied' });
  try {
    await page.goto(base + '/index.html');
    await page.tap('#allowBtn');
    await page.waitForFunction(() => localStorage.getItem('fg.loc'), null, { timeout: 15000 });
    assert.equal(await page.evaluate(() => localStorage.getItem('fg.compass')), 'denied');
    await page.waitForURL('**/viewer.html', { timeout: 10000 }); // refusing motion access does not stop the visitor
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

test('sky view: north stays put while the phone goes from flat to upright and back (Android-style absolute readings)', { skip }, async () => {
  const { page, context, errors } = await iphone({ storage: { ...SAVED, 'fg.compass': 'granted' } });
  try {
    await page.goto(base + '/viewer.html');
    // An Android phone held upright in portrait reports a screen angle of 0. This WebKit test browser reports 90 for its
    // portrait window, which a real phone never does, so say what Chrome on Android would.
    // (set on the prototype, because some builds hand out a new orientation object on every read)
    await page.evaluate(() => { Object.defineProperty(Object.getPrototypeOf(screen.orientation), 'angle', { get: () => 0, configurable: true }); });
    const facing = () => page.evaluate(() => window.__test_state ? 0 : document.querySelector('#facing').textContent);
    // The phone faces magnetic 90 (east). Raise it from flat to upright and lower it again, sending absolute readings.
    const send = async (tilt, times = 25) => {
      for (let i = 0; i < times; i++) {
        await page.evaluate((b) => { const e = new Event('deviceorientationabsolute'); e.alpha = 270; e.beta = b; e.gamma = 0; e.absolute = true; window.dispatchEvent(e); }, tilt);
        await sleep(10);
      }
    };
    await send(0, 40);
    const flat = await facing();
    const seen = new Set();
    for (const tilt of [20, 45, 70, 90, 100, 90, 70, 45, 20, 0]) { await send(tilt); seen.add(await facing()); }
    assert.equal(seen.size, 1, 'the heading never moved: ' + [...seen].join(' | '));
    assert.equal([...seen][0], flat, 'and it is the heading it started at');
    assert.match(flat, /Facing E 9\d° \(true\)|Facing E[A-Z]* \d+° \(true\)/);
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

test('accessibility: arrow keys switch tabs and walk the radar, and the hidden page cannot be reached', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await context.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
    await page.goto(base + '/viewer.html?fgtest=1');
    await page.evaluate(FAKE_SKY);
    assert.equal(await page.evaluate(() => document.querySelector('#pageNearby').inert), true, 'the Nearby page is out of reach while Radar shows');
    await page.focus('#sky');
    await page.keyboard.press('ArrowRight');
    const first = await page.evaluate(() => __fg.state.sel);
    await page.keyboard.press('ArrowRight');
    const second = await page.evaluate(() => __fg.state.sel);
    assert.ok(first && second && first !== second, 'the arrow keys move from one object to the next');
    await page.focus('#tabRadar');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.getAttribute('#tabNearby', 'aria-selected'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'tabNearby');
    assert.equal(await page.evaluate(() => document.querySelector('#pageRadar').inert), true);
    assert.equal(await page.evaluate(() => document.querySelector('#pageNearby').inert), false);
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.getAttribute('#tabRadar', 'aria-selected'), 'true');
  } finally { await context.close(); }
});

test('security: the policy blocks nothing the pages need, and the CDN libraries pass their integrity check', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    const problems = [];
    page.on('console', (m) => { if (/content security policy|integrity|refused to/i.test(m.text())) problems.push(m.text()); });
    for (const p of ['/index.html', '/about.html', '/settings.html', '/viewer.html']) await page.goto(base + p);
    await page.waitForFunction(() => window.satellite && window.Astronomy, null, { timeout: 20000 });
    assert.deepEqual(problems, []);
    assert.equal(await page.evaluate(() => typeof satellite.twoline2satrec + typeof Astronomy.Body), 'functionobject');
  } finally { await context.close(); }
});

// A sky for the camera view: the Moon right ahead (facing 90°, level), with the Sun to one side of it.
const AR_SKY = (phase, sunAz) => `(() => {
  const { state } = window.__fg;
  state.declination = 0; state.ori.declination = 0; state.arOffset = { h: 0, p: 0 };
  const mk = (id, kind, name, az, el, extra) => Object.assign({ id, kind, name, az, el, distKm: 1, range: 1 }, extra || {});
  state.objs = [mk('body:Moon', 'body', 'Moon', 90, 0, { phase: ${phase}, color: '#e6ecf5' }), mk('body:Sun', 'body', 'Sun', ${sunAz}, 0, { phase: null, color: '#ffd86b' })];
  state.byId = new Map(state.objs.map((o) => [o.id, o]));
  state.sel = null; state.dirty = true;
})()`;

// Opens the camera view, facing east with the phone upright, and lets the heading settle.
async function openAr(page, sky) {
  await page.evaluate(sky);
  await page.tap('#arBtn');
  await page.waitForFunction(() => !document.querySelector('#ar').hidden, null, { timeout: 15000 });
  for (let i = 0; i < 30; i++) {
    await page.evaluate(() => { const e = new Event('deviceorientation'); e.webkitCompassHeading = 90; e.alpha = 0; e.beta = 90; e.gamma = 0; e.absolute = false; window.dispatchEvent(e); });
    await sleep(30);
  }
  await sleep(300);
}

// How much of the Moon's disc around the middle of the screen is bright, on the left and right halves.
const litHalves = (page) => page.evaluate(() => {
  const cv = document.querySelector('#arCanvas'), c = cv.getContext('2d'), s = cv.width / cv.clientWidth;
  const cx = Math.round(cv.width / 2), cy = Math.round(cv.height / 2), r = Math.round(16 * s);
  const d = c.getImageData(cx - r, cy - r, 2 * r, 2 * r);
  let left = 0, right = 0, total = 0;
  for (let y = 0; y < 2 * r; y++) for (let x = 0; x < 2 * r; x++) {
    if (Math.hypot(x - r, y - r) > r * 0.92) continue;
    total++;
    const i = (y * 2 * r + x) * 4, bright = d.data[i] > 150 && d.data[i + 3] > 200;
    if (bright) { if (x < r) left++; else right++; }
  }
  return { left, right, total };
});

test('AR: the Moon is drawn lit on the side toward the Sun, with the right amount lit', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await context.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
    await page.goto(base + '/viewer.html?fgtest=1');
    await openAr(page, AR_SKY(0.5, 100));
    let h = await litHalves(page);
    assert.ok(h.right > h.total * 0.3 && h.left < h.total * 0.05, 'Sun on the right: the right half is lit ' + JSON.stringify(h));
    await page.evaluate(AR_SKY(0.5, 80)); await sleep(400);
    h = await litHalves(page);
    assert.ok(h.left > h.total * 0.3 && h.right < h.total * 0.05, 'Sun on the left: the left half is lit ' + JSON.stringify(h));
    await page.evaluate(AR_SKY(0.1, 100)); await sleep(400);
    const crescent = await litHalves(page);
    await page.evaluate(AR_SKY(0.9, 100)); await sleep(400);
    const gibbous = await litHalves(page);
    await page.evaluate(AR_SKY(0.5, 100)); await sleep(400);
    const half = await litHalves(page);
    const lit = (x) => x.left + x.right;
    assert.ok(lit(crescent) > 0 && lit(crescent) < lit(half) * 0.7, 'a crescent is thin: ' + JSON.stringify([crescent, half]));
    assert.ok(lit(gibbous) > lit(half) * 1.3, 'a gibbous Moon is mostly lit: ' + JSON.stringify([gibbous, half]));
  } finally { await context.close(); }
});

test('AR: the Photo button makes a PNG of the picture with the overlay and shares it', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await context.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
    await page.goto(base + '/viewer.html?fgtest=1');
    await page.evaluate(() => {
      window.__shared = [];
      navigator.canShare = () => true;
      navigator.share = async (d) => {
        const f = d.files[0], buf = new Uint8Array(await f.arrayBuffer());
        const bmp = await createImageBitmap(f), c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
        const x = c.getContext('2d'); x.drawImage(bmp, 0, 0);
        const cx = Math.round(bmp.width / 2), cy = Math.round(bmp.height / 2);
        const px = x.getImageData(cx + 6, cy, 1, 1).data;
        window.__shared.push({ name: f.name, type: f.type, sig: Array.from(buf.slice(0, 4)), w: bmp.width, h: bmp.height, r: px[0] });
      };
    });
    await openAr(page, AR_SKY(0.5, 100));
    await page.tap('#arShot');
    await page.waitForFunction(() => window.__shared.length === 1, null, { timeout: 10000 });
    const s = await page.evaluate(() => window.__shared[0]);
    assert.equal(s.name, 'fargems-sky.png');
    assert.equal(s.type, 'image/png');
    assert.deepEqual(s.sig, [0x89, 0x50, 0x4e, 0x47], 'a real PNG');
    const size = await page.evaluate(() => { const c = document.querySelector('#arCanvas'); return [c.width, c.height]; });
    assert.deepEqual([s.w, s.h], size, 'as big as the screen');
    assert.ok(s.r > 150, 'the lit Moon from the overlay is in the picture (red channel ' + s.r + ')');
  } finally { await context.close(); }
});

test('AR: without a share sheet the picture is saved as a file', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await context.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
    await page.goto(base + '/viewer.html?fgtest=1');
    await page.evaluate(() => { Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true }); window.__clicks = []; HTMLAnchorElement.prototype.click = function () { window.__clicks.push([this.download, this.href.slice(0, 5)]); }; });
    await openAr(page, AR_SKY(0.5, 100));
    await page.tap('#arShot');
    await page.waitForFunction(() => window.__clicks.length === 1, null, { timeout: 10000 });
    assert.deepEqual(await page.evaluate(() => window.__clicks[0]), ['fargems-sky.png', 'blob:']);
    assert.ok((await page.evaluate(() => window.__toasts)).includes('Picture saved.'));
  } finally { await context.close(); }
});

test('AR: dragging in line-up mode corrects the heading, keeps it, and the radar uses it too', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await context.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
    await page.goto(base + '/viewer.html?fgtest=1');
    await openAr(page, AR_SKY(0.5, 100));
    assert.equal(await page.isVisible('#arAlignBar'), false);
    await page.tap('#arAlign');
    assert.equal(await page.isVisible('#arAlignBar'), true);
    assert.equal(await page.getAttribute('#arAlign', 'aria-pressed'), 'true');
    const box = await page.locator('#arCanvas').boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 60, y, { steps: 6 }); await page.mouse.up();
    const off = await page.evaluate(() => __fg.state.arOffset);
    assert.ok(off.h < -1 && off.h > -15, 'dragging right lowers the heading: ' + JSON.stringify(off));
    assert.equal(await page.evaluate(() => __fg.state.sel), null, 'a drag chooses nothing');
    assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('fg.arOffset'))), off, 'kept for next time');
    // The Moon is now drawn to the right of the middle by about the drag.
    await sleep(300);
    const where = await page.evaluate(() => { const cv = document.querySelector('#arCanvas'), c = cv.getContext('2d'), s = cv.width / cv.clientWidth, y = Math.round(cv.height / 2); const row = c.getImageData(0, y, cv.width, 1).data; let sx = 0, n = 0; for (let i = 0; i < cv.width; i++) if (row[i * 4] > 150 && row[i * 4 + 3] > 200) { sx += i; n++; } return n ? sx / n / s - cv.clientWidth / 2 : null; });
    assert.ok(where != null && where > 5, 'the Moon moved right of the middle (' + where + ' px)');
    // The radar takes the same correction.
    await heading(page, 100, 40);
    assert.ok(Math.abs(await page.evaluate(() => __fg.state.heading) - (100 + off.h + 360) % 360) < 0.6, 'the radar heading includes the correction');
    await page.tap('#arAlignReset');
    assert.deepEqual(await page.evaluate(() => __fg.state.arOffset), { h: 0, p: 0 });
    await page.tap('#arAlignDone');
    assert.equal(await page.isVisible('#arAlignBar'), false);
    assert.equal(await page.getAttribute('#arAlign', 'aria-pressed'), 'false');
  } finally { await context.close(); }
});

test('distances: the Sun and planets are short, can be shown in AU or light time, and the choice is made in Settings', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await context.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
    const sky = `(() => {
      const { state, renderNearby, renderDetail } = window.__fg;
      const mk = (id, kind, name, az, el, distKm, extra) => Object.assign({ id, kind, name, az, el, distKm, range: distKm }, extra || {});
      state.objs = [mk('body:Sun', 'body', 'Sun', 100, 30, 149597870.7, { phase: null, color: '#ffd86b' }), mk('body:Moon', 'body', 'Moon', 68, 49, 384400, { phase: 0.5, color: '#e6ecf5' })];
      state.byId = new Map(state.objs.map((o) => [o.id, o])); state.sel = 'body:Sun'; state.dirty = true;
      renderNearby(); renderDetail();
    })()`;
    await page.goto(base + '/settings.html'); // this browser speaks en-US, which would default to miles
    await page.selectOption('#unitsSelect', 'metric');
    await page.goto(base + '/viewer.html?fgtest=1');
    await page.evaluate(sky);
    const meta = (id) => page.textContent(`.nearby-row[data-id="${id}"] .meta`);
    assert.equal(await meta('body:Sun'), '149.6 million km', 'short, not 149,597,871 km');
    assert.equal(await meta('body:Moon'), '384,400 km', 'the Moon keeps its number');
    const card = await page.textContent('#detail');
    assert.match(card, /Distance\s*149\.6 million km/);
    assert.match(card, /Light takes\s*8 min 19 s/);
    // Settings: choose AU. The page takes it from storage.
    await page.goto(base + '/settings.html');
    await page.selectOption('#farSelect', 'au');
    assert.equal(await page.evaluate(() => localStorage.getItem('fg.far')), 'au');
    assert.match(await page.textContent('#farHelp'), /One AU is the average distance from the Earth to the Sun/);
    await page.goto(base + '/viewer.html?fgtest=1');
    await page.evaluate(sky);
    assert.equal(await meta('body:Sun'), '1.00 AU');
    assert.equal(await page.getAttribute('#detail abbr', 'title'), 'astronomical unit: the average distance from the Earth to the Sun, about 150 million km', 'the card explains the unit');
    // Light travel time.
    await page.goto(base + '/settings.html');
    await page.selectOption('#farSelect', 'light');
    await page.goto(base + '/viewer.html?fgtest=1');
    await page.evaluate(sky);
    assert.equal(await meta('body:Sun'), '8 min 19 s by light');
    // Miles for the same Sun.
    await page.goto(base + '/settings.html');
    await page.selectOption('#farSelect', 'units');
    await page.selectOption('#unitsSelect', 'imperial');
    await page.goto(base + '/viewer.html?fgtest=1');
    await page.evaluate(sky);
    assert.equal(await meta('body:Sun'), '93.0 million mi');
    assert.equal(await meta('body:Moon'), '238,855 mi');
  } finally { await context.close(); }
});
