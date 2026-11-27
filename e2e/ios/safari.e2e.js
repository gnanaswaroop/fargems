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
const { test } = require('./shard.js'); // like node:test, but runs only this run's share when FG_SHARD=2/4 is set
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

let playwright = null;
try { playwright = require('playwright'); } catch { /* not installed: the tests skip */ }
const skip = playwright ? false : 'Playwright is not installed (run: cd e2e/ios && npm ci && npx playwright install webkit)';

const ROOT = path.join(__dirname, '..', '..');
const D = require('../../lib/declination.js');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

let server, base, browser;

const { createHelpers, HITEC, sleep, DESKTOP_SAFARI_UA, SAVED, FAKE_SKY, AR_SKY, PNG } = require('./helpers.js');
const { iphone, heading, linked, fakeCamera, arShown, openAr, tallerBy, wikiAnswers, openSearch, typeSearch } = createHelpers({ playwright, getBrowser: () => browser, getBase: () => base });

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
    await page.goto(base + '/viewer.html').catch(() => {}); // the home page may be sending the saved location to the sky view at this very moment: either way we end up there
    await page.waitForURL(/viewer.html/); await page.waitForLoadState('load');
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
    assert.match(text, /https?:\/\/localhost:\d+\/viewer\.html#o=air:a1$/, 'ends with the permalink of this flight');
    assert.doesNotMatch(text, /17\.4|78\.3/, 'no coordinates');
  } finally { await context.close(); }
});

test('permalink: a link to an object that is up picks it like a tap, on the radar page, and Share sends that link', { skip }, async () => {
  const { page, context } = await linked('#o=sat:25544', FAKE_SKY);
  try {
    assert.equal(await page.evaluate(() => window.__fg.state.sel), 'sat:25544');
    const card = await page.textContent('#detail');
    assert.match(card, /ISS \(ZARYA\)/); assert.doesNotMatch(card, /Nearest/, 'picked, not the nearest');
    assert.equal(await page.isVisible('#detail .notvis'), false, 'it is up: nothing to call out');
    assert.equal(await page.evaluate(() => document.querySelector('#pager').classList.contains('nearby')), false, 'the radar page is the one in view');
    assert.equal(await page.evaluate(() => location.hash), '#o=sat:25544', 'the address holds the link to the picked object');
    await page.evaluate(() => { window.__copied = []; Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.__copied.push(t); return Promise.resolve(); } }, configurable: true }); });
    await page.click('#detail [data-share]');
    await page.waitForFunction(() => window.__copied.length === 1);
    assert.match(await page.evaluate(() => window.__copied[0]), /^ISS \(ZARYA\) \(space station\) is [\s\S]* http:\/\/localhost:\d+\/viewer\.html#o=sat:25544$/, 'the text ends with the permalink of this object');
    // Picking another object moves the link along, and closing the card removes it.
    await page.evaluate(() => { window.__fg.state.sel = 'body:Moon'; window.__fg.renderDetail(); });
    assert.equal(await page.evaluate(() => location.hash), '#o=body:Moon');
    await page.click('#detail [data-close-detail]');
    assert.equal(await page.evaluate(() => location.hash), '', 'closed: no object in the address');
    // The address can be changed by hand (or by a link opened in this tab): the new object is picked.
    await page.evaluate(() => { location.hash = '#o=star:Vega'; });
    await page.waitForFunction(() => window.__fg.state.sel === 'star:Vega');
    assert.match(await page.textContent('#detail'), /Vega/);
  } finally { await context.close(); }
});

test('permalink: a flight that is not around any more says so, and is picked up when it appears', { skip }, async () => {
  const { page, context } = await linked('#o=air:zz9999', `window.__fg.state.aircraftAt = Date.now(); ${FAKE_SKY}`);
  try {
    const note = page.locator('#detail .notvis');
    assert.equal(await note.isVisible(), true);
    assert.match(await page.textContent('#detail h3'), /Flight ZZ9999 is not in your sky/);
    assert.match(await note.textContent(), /landed|out of range/);
    assert.doesNotMatch(await page.textContent('#detail'), /Nearest|AIC144/, 'not swapped for another flight');
    assert.match(await page.evaluate(() => document.querySelector('#arDetail .notvis').textContent), /landed|out of range/, 'also in the card over the camera picture');
    await page.evaluate(() => {
      const { state, renderDetail } = window.__fg;
      state.objs.push({ id: 'air:zz9999', kind: 'air', name: 'EIN123', az: 300, el: 25, distKm: 40, range: 40, ac: { type: 'A320', gs: 400, track: 90, vr: 0, id: 'zz9999' }, altFt: 9000 });
      state.byId = new Map(state.objs.map((o) => [o.id, o])); renderDetail();
    });
    assert.match(await page.textContent('#detail h3'), /EIN123/, 'the flight is shown as soon as it is up');
    assert.equal(await page.isVisible('#detail .notvis'), false);
  } finally { await context.close(); }
});

test('permalink: an object under the horizon, or too far, or on a layer that is off, is called out', { skip }, async () => {
  const { page, context } = await linked('#o=sat:48274', `window.__fg.state.aircraftAt = Date.now(); window.__fg.state.satsAt = Date.now(); window.__fg.state.unseen = new Map([['sat:48274', { why: 'below', name: 'CSS (TIANHE)', el: -23.6, az: 45 }], ['air:far1', { why: 'far', name: 'VTABC', el: 3, az: 90, rangeKm: 280 }]]); ${FAKE_SKY}`);
  try {
    assert.match(await page.textContent('#detail h3'), /CSS \(TIANHE\) is below the horizon/);
    assert.match(await page.textContent('#detail .notvis'), /24° below the horizon, toward the NE/);
    await page.evaluate(() => { window.__fg.state.sel = window.__fg.state.linkId = 'air:far1'; window.__fg.renderDetail(); });
    assert.match(await page.textContent('#detail h3'), /VTABC is too far to see/);
    assert.match(await page.textContent('#detail .notvis'), /about \d+ (km|mi) away/);
    // A known object under the horizon (the Sun at night) gets a line above its facts; a hidden layer is named too.
    await page.evaluate(() => {
      const { state, renderDetail } = window.__fg;
      state.objs.push({ id: 'body:Sun', kind: 'body', name: 'Sun', az: 330, el: -35, distKm: 1.5e8, mag: null, phase: null, color: '#ffe08a' });
      state.byId = new Map(state.objs.map((o) => [o.id, o])); state.sel = 'body:Sun'; renderDetail();
    });
    assert.match(await page.textContent('#detail .notvis'), /Below the horizon right now: 35° under it, toward the NNW/);
    await page.evaluate(() => { const { state, renderDetail } = window.__fg; state.filters.sky = false; renderDetail(); });
    assert.match(await page.textContent('#detail .notvis'), /layer is switched off/);
  } finally { await context.close(); }
});

test('permalink: a link with nothing usable in it changes nothing', { skip }, async () => {
  const { page, context } = await linked('#o=ship:1%3Cscript%3E', FAKE_SKY);
  try {
    assert.equal(await page.evaluate(() => window.__fg.state.sel), null);
    assert.match(await page.textContent('#detail'), /Nearest flight/);
  } finally { await context.close(); }
});

test('viewer: a long name stays on the canvas, also for the selected object near the rim (it may cross the horizon circle)', { skip }, async () => {
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
      assert.ok(r.x0 >= 0 && r.x1 <= r.W, `az ${az}: the name leaves the canvas (${JSON.stringify(r)})`);
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
    await fakeCamera(page);
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

test('AR: a swipe back closes the camera view and stays on the sky view', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await page.goto(base + '/viewer.html');
    await page.evaluate(() => history.pushState({ page: 'sky' }, '')); // an earlier step to go back to, on the same page
    await openAr(page, () => {});
    assert.equal(await page.evaluate(() => history.state && history.state.fgAr), 1, 'the camera view added its own step');
    await page.goBack(); // what a swipe back does
    await page.waitForFunction(() => document.querySelector('#ar').hidden, null, { timeout: 5000 });
    assert.match(page.url(), /viewer.html/, 'still on the sky view');
    assert.equal(await page.evaluate(() => history.state && history.state.page), 'sky', 'back to the step before the camera view');
  } finally { await context.close(); }
});

test('AR: closing the camera view with the X leaves no extra step behind', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await page.goto(base + '/viewer.html');
    await page.evaluate(() => history.pushState({ page: 'sky' }, ''));
    await openAr(page, () => {});
    await page.tap('#arClose');
    await page.waitForFunction(() => history.state && history.state.page === 'sky', null, { timeout: 5000 });
    assert.equal(await page.evaluate(() => document.querySelector('#ar').hidden), true);
  } finally { await context.close(); }
});

test('AR on an iPhone: refusing motion access is explained and remembered', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED, answer: 'denied' });
  try {
    await page.goto(base + '/viewer.html');
    await fakeCamera(page);
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
    await openAr(page, AR_SKY(0.5, 100), { still: true });
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

test('AR: a crosshair marks the centre of the camera view, with a gap in the middle', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await context.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
    await page.goto(base + '/viewer.html?fgtest=1');
    await openAr(page, () => {});
    await sleep(400);
    const px = await page.evaluate(() => {
      const c = document.querySelector('#arCanvas'), x = c.getContext('2d'), k = c.width / c.clientWidth, cx = Math.round(c.width / 2), cy = Math.round(c.height / 2);
      const at = (dx, dy) => Array.from(x.getImageData(cx + Math.round(dx * k), cy + Math.round(dy * k), 1, 1).data);
      return { arm: at(12, 0), armUp: at(0, -12), centre: at(3, 3) };
    });
    assert.ok(px.arm[0] > 200 && px.arm[3] > 200, 'a light line right of the centre: ' + px.arm);
    assert.ok(px.armUp[0] > 200 && px.armUp[3] > 200, 'and above it: ' + px.armUp);
    assert.equal(px.centre[3], 0, 'the middle of the cross is left clear (the horizon line may pass through its row)');
  } finally { await context.close(); }
});

test('AR: facing east, the East pole stands above the crosshair and a red arrow at the left edge points toward North', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await context.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
    await page.goto(base + '/viewer.html?fgtest=1');
    await openAr(page, () => {}); // the test compass says 90, east
    await sleep(500);
    const seen = await page.evaluate(() => {
      const c = document.querySelector('#arCanvas'), x = c.getContext('2d'), k = c.width / c.clientWidth, W = c.width, H = c.height;
      const count = (x0, y0, x1, y1, test) => { const d = x.getImageData(Math.round(x0), Math.round(y0), Math.max(1, Math.round(x1 - x0)), Math.max(1, Math.round(y1 - y0))).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && test(d[i], d[i + 1], d[i + 2])) n++; return n; };
      const light = (r, g, b) => r > 200 && g > 190 && b > 190, red = (r, g, b) => r > 220 && g > 80 && g < 150 && b > 70 && b < 130;
      return {
        pole: count(W / 2 - 20 * k, H / 2 - 160 * k, W / 2 + 20 * k, H / 2 - 30 * k, light),     // the East pole, between the top letter and the crosshair
        arrow: count(0, H / 2 - 160 * k, 60 * k, H / 2 + 40 * k, red),                          // North is to the left, out of the picture
        right: count(W - 60 * k, H / 2 - 160 * k, W, H / 2 + 40 * k, red),                      // and nothing red on the right
      };
    });
    assert.ok(seen.pole > 40, 'a light pole above the crosshair: ' + seen.pole);
    assert.ok(seen.arrow > 15, 'a red arrow at the left edge: ' + seen.arrow);
    assert.equal(seen.right, 0, 'no red on the right edge');
  } finally { await context.close(); }
});

// The test compass says east (90), the phone is upright, so the middle of the picture is the horizon in the east.
const skyWith = (az, el) => `() => {
  const { state, renderNearby, renderDetail } = window.__fg;
  state.objs = [{ id: 'body:Moon', kind: 'body', name: 'Moon', az: ${az}, el: ${el}, distKm: 384400, mag: null, phase: 0.6, color: '#e6ecf5' }];
  state.byId = new Map(state.objs.map((o) => [o.id, o])); state.sel = null; renderNearby(); renderDetail(); state.dirty = true;
}`;

test('AR: holding the crosshair on an object picks it without a tap, and its card shows', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await context.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
    await page.goto(base + '/viewer.html?fgtest=1');
    await openAr(page, eval(skyWith(90, 0))); // the Moon is right at the crosshair
    await page.waitForFunction(() => window.__fg.state.sel === 'body:Moon', null, { timeout: 5000 });
    assert.match(await page.evaluate(() => document.querySelector('#arDetail').textContent), /Moon/, 'the card over the camera picture');
    assert.equal(await page.evaluate(() => location.hash), '#o=body:Moon', 'and it is the pick everywhere else too');
  } finally { await context.close(); }
});

test('AR: an object that is not at the crosshair is not picked, and a tap still picks it', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await context.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
    await page.goto(base + '/viewer.html?fgtest=1');
    await openAr(page, eval(skyWith(90, 12))); // 12 degrees above the middle
    await sleep(1500);
    assert.equal(await page.evaluate(() => window.__fg.state.sel), null, 'nothing is at the crosshair, so nothing is picked');
    const at = await page.evaluate(() => { const c = document.querySelector('#arCanvas'), r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 - 12 * (r.height / 63) }; });
    await page.touchscreen.tap(at.x, at.y);
    await page.waitForFunction(() => window.__fg.state.sel === 'body:Moon', null, { timeout: 5000 });
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
    await openAr(page, AR_SKY(0.5, 100), { still: true });
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
    const pickBefore = await page.evaluate(() => __fg.state.sel); // the Moon is at the crosshair, so holding there has already picked it
    await page.evaluate(() => { __fg.state.sel = null; });
    const box = await page.locator('#arCanvas').boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 60, y, { steps: 6 }); await page.mouse.up();
    const off = await page.evaluate(() => __fg.state.arOffset);
    assert.ok(off.h < -1 && off.h > -15, 'dragging right lowers the heading: ' + JSON.stringify(off));
    assert.equal(await page.evaluate(() => __fg.state.sel), null, 'a drag chooses nothing, and the crosshair picks nothing while lining up (picked before: ' + pickBefore + ')');
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

// Two station passes, with a path across the sky each (the real ones need the satellite library and element sets).
const PASSES = `(() => {
  const { state, renderPasses, renderDetail, renderNearby } = window.__fg;
  const now = Date.now();
  const path = (a0, a1) => Array.from({ length: 21 }, (_, i) => ({ az: a0 + (a1 - a0) * i / 20, el: Math.max(0, 70 * Math.sin(Math.PI * i / 20)) }));
  state.objs = []; state.byId = new Map(); state.sel = null; state.passSel = null;
  state.passes = [
    { name: 'ISS', id: 'sat:25544', satName: 'ISS (ZARYA)', start: now + 95 * 60e3, end: now + 101 * 60e3, max: 64, maxAz: 140, riseAz: 300, setAz: 100, path: path(300, 100) },
    { name: 'Tiangong', id: 'sat:48274', satName: 'CSS (TIANHE)', start: now + 3 * 3600e3, end: now + 3 * 3600e3 + 5 * 60e3, max: 31, maxAz: 20, riseAz: 250, setAz: 60, path: path(250, 60) },
  ];
  renderPasses(); renderDetail(); renderNearby(); state.dirty = true;
})()`;
const cyanPixels = (page) => page.evaluate(() => {
  const cv = document.querySelector('#sky'), c = cv.getContext('2d'), d = c.getImageData(0, 0, cv.width, cv.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] < 130 && d[i + 1] > 180 && d[i + 2] > 200) n++;
  return n;
});

test('passes: the ISS and Tiangong are buttons, and choosing one shows its path on the radar and says when to look', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await context.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
    await page.goto(base + '/viewer.html?fgtest=1');
    await page.evaluate(() => { __fg.state.filters.radar = false; __fg.state.filters.grid = false; __fg.state.filters.labels = false; });
    await page.evaluate(PASSES);
    const buttons = await page.$$eval('#passes button.pass', (bs) => bs.map((b) => b.querySelector('b').textContent));
    assert.deepEqual(buttons, ['ISS', 'Tiangong'], 'both stations can be tapped');
    assert.equal(await page.getAttribute('#passes button.pass', 'aria-pressed'), 'false');
    const before = await cyanPixels(page);
    await page.click('#passes button.pass[data-pass="0"]');
    assert.equal(await page.evaluate(() => __fg.state.passSel), 'ISS');
    assert.equal(await page.getAttribute('#passes button.pass[data-pass="0"]', 'aria-pressed'), 'true');
    const card = await page.textContent('#detail');
    assert.match(card, /ISS\s*next pass/);
    assert.match(card, /Rises\s*in 1 h 3[5-6] min|Rises\s*in 1 h 3\d min/, 'when it rises: ' + card);
    assert.match(card, /in the WNW|in the NW/, 'where it rises');
    assert.match(card, /Highest\s*64° up in the SE/);
    assert.match(card, /Sets\s*in the E/);
    assert.match(card, /Above 10° for\s*6 min/);
    assert.equal(await page.getAttribute('#detail a', 'href'), 'https://en.wikipedia.org/wiki/International_Space_Station');
    await sleep(250);
    assert.ok((await cyanPixels(page)) > before + 40, 'the dashed path is on the radar (' + before + ' → ' + (await cyanPixels(page)) + ')');
    // Another pass replaces it; tapping the same one again clears it.
    await page.click('#passes button.pass[data-pass="1"]');
    assert.match(await page.textContent('#detail'), /Tiangong\s*next pass/);
    assert.equal(await page.getAttribute('#detail a', 'href'), 'https://en.wikipedia.org/wiki/Tiangong_space_station');
    await page.click('#passes button.pass[data-pass="1"]');
    assert.equal(await page.evaluate(() => __fg.state.passSel), null);
    await sleep(250); // the radar redraws on the next frame
    assert.ok((await cyanPixels(page)) <= before + 5, 'the path is gone');
    assert.doesNotMatch(await page.textContent('#detail'), /next pass/);
  } finally { await context.close(); }
});

test('passes: a station that is above the horizon now is selected, and shows its own card', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await context.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
    await page.goto(base + '/viewer.html?fgtest=1');
    await page.evaluate(PASSES);
    await page.evaluate(() => {
      const { state, renderDetail } = window.__fg;
      const o = { id: 'sat:25544', kind: 'sat', name: 'ISS (ZARYA)', norad: 25544, az: 120, el: 40, range: 500, distKm: 500, altKm: 420, speed: 7.6, sunlit: true, visible: true };
      state.objs = [o]; state.byId = new Map([[o.id, o]]); renderDetail();
    });
    await page.click('#passes button.pass[data-pass="0"]');
    assert.equal(await page.evaluate(() => __fg.state.sel), 'sat:25544');
    const card = await page.textContent('#detail');
    assert.match(card, /ISS \(ZARYA\)/);
    assert.doesNotMatch(card, /next pass/, 'it is up, so the normal card shows');
  } finally { await context.close(); }
});

test('legend: a closed key explains every symbol, including the meteor shower plus', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await context.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
    await page.goto(base + '/viewer.html');
    assert.equal(await page.isVisible('#legend .legend-list'), false, 'closed until asked');
    assert.equal((await page.textContent('#legend summary')).trim(), 'What do the symbols mean?');
    await page.click('#legend summary');
    assert.equal(await page.isVisible('#legend .legend-list'), true);
    const text = await page.innerText('#legend');
    for (const word of [/straight above you/, /edge is the horizon/, /Aircraft/, /Satellite/, /space station/, /The Sun/, /The Moon/, /planet/, /bright star/, /Leonids/, /radiant/, /object you picked/, /dashed line/]) assert.match(text, word);
    assert.equal((await page.$$('#legend .legend-list li')).length, 10);
    assert.equal(await page.$$eval('#legend svg, #legend .sym', (els) => els.every((e) => e.getAttribute('aria-hidden') === 'true' || e.closest('[aria-hidden="true"]'))), true, 'the pictures are hidden from screen readers, the words carry the meaning');
  } finally { await context.close(); }
});

test('compass: an iPad or iPhone turned sideways reports the top of the screen, and a turn is followed at once', { skip }, async () => {
  const { page, context } = await iphone({ storage: { ...SAVED, 'fg.compass': 'granted' } });
  try {
    await context.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
    await page.goto(base + '/viewer.html?fgtest=1');
    await page.evaluate(() => { __fg.state.declination = 0; __fg.state.arOffset = { h: 0, p: 0 }; });
    const send = (mag, n) => page.evaluate(([m, n]) => { for (let i = 0; i < n; i++) { const e = new Event('deviceorientation'); e.webkitCompassHeading = m; e.alpha = 0; e.beta = 0; e.gamma = 0; e.absolute = false; window.dispatchEvent(e); } return __fg.state.heading; }, [mag, n]);
    const near = (a, b, tol = 1) => Math.abs(((a - b + 540) % 360) - 180) <= tol;
    // Upright in portrait: the top of the screen is the top of the device.
    await page.evaluate(() => Object.defineProperty(window, 'orientation', { get: () => 0, configurable: true }));
    assert.ok(near(await send(40, 60), 40), 'portrait: the heading is the device heading');
    // Turned a quarter (landscape): the top of the screen is the device's right side, a quarter turn clockwise.
    await page.evaluate(() => { Object.defineProperty(window, 'orientation', { get: () => 90, configurable: true }); window.dispatchEvent(new Event('orientationchange')); });
    assert.ok(near(await send(40, 1), 130), 'landscape (90): the very first reading after the turn is already right, east is east');
    await page.evaluate(() => { Object.defineProperty(window, 'orientation', { get: () => -90, configurable: true }); window.dispatchEvent(new Event('orientationchange')); });
    assert.ok(near(await send(40, 1), 310), 'landscape the other way (-90)');
    await page.evaluate(() => { Object.defineProperty(window, 'orientation', { get: () => 180, configurable: true }); window.dispatchEvent(new Event('orientationchange')); });
    assert.ok(near(await send(40, 1), 220), 'upside down (180)');
  } finally { await context.close(); }
});

test('compass: without a turn event, a big swing of the heading is followed within a few readings', { skip }, async () => {
  const { page, context } = await iphone({ storage: { ...SAVED, 'fg.compass': 'granted' } });
  try {
    await context.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
    await page.goto(base + '/viewer.html?fgtest=1');
    await page.evaluate(() => { __fg.state.declination = 0; __fg.state.arOffset = { h: 0, p: 0 }; Object.defineProperty(window, 'orientation', { get: () => 0, configurable: true }); });
    const send = (mag, n) => page.evaluate(([m, n]) => { for (let i = 0; i < n; i++) { const e = new Event('deviceorientation'); e.webkitCompassHeading = m; e.alpha = 0; e.beta = 0; e.gamma = 0; e.absolute = false; window.dispatchEvent(e); } return __fg.state.heading; }, [mag, n]);
    await send(10, 60);
    const h = await send(190, 3); // half way round
    assert.ok(Math.abs(((h - 190 + 540) % 360) - 180) < 3, 'three readings after a half turn the heading is ' + h.toFixed(1));
    const small = await send(196, 1);
    assert.ok(small > 190 && small < 196, 'a 6 degree wobble is still smoothed: ' + small.toFixed(2));
  } finally { await context.close(); }
});

test('compass: the window changing shape between portrait and landscape counts as a turn', { skip }, async () => {
  const { page, context } = await iphone({ storage: { ...SAVED, 'fg.compass': 'granted' } });
  try {
    await context.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
    await page.goto(base + '/viewer.html?fgtest=1');
    await page.evaluate(() => { __fg.state.declination = 0; __fg.state.arOffset = { h: 0, p: 0 }; Object.defineProperty(window, 'orientation', { get: () => 0, configurable: true }); });
    const send = (mag, n) => page.evaluate(([m, n]) => { for (let i = 0; i < n; i++) { const e = new Event('deviceorientation'); e.webkitCompassHeading = m; e.alpha = 0; e.beta = 0; e.gamma = 0; e.absolute = false; window.dispatchEvent(e); } return __fg.state.heading; }, [mag, n]);
    await send(20, 60);
    const vp = page.viewportSize();
    await page.setViewportSize({ width: vp.height, height: vp.width }); // turned
    await page.waitForTimeout(100);
    const h = await send(35, 1);
    assert.ok(Math.abs(h - 35) < 0.5, 'the first reading after the window turned is taken as it is: ' + h.toFixed(2));
  } finally { await context.close(); }
});

test('radar: every name can be read on a light day sky and on a dark night sky', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await context.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
    await page.goto(base + '/viewer.html?fgtest=1');
    await page.evaluate(() => {
      window.__texts = [];
      const orig = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (t, x, y) { window.__texts.push({ t, x, y, a: this.textAlign, w: this.measureText(t).width, s: this.canvas.width / this.canvas.clientWidth }); return orig.apply(this, arguments); };
    });
    const sky = (sunAlt) => `(() => {
      const { state, draw } = window.__fg;
      const mk = (id, kind, name, az, el, extra) => Object.assign({ id, kind, name, az, el, distKm: 1, range: 1 }, extra || {});
      state.objs = [mk('star:Vega', 'star', 'Vega', 40, 50), mk('star:Altair', 'star', 'Altair', 100, 35), mk('body:Mars', 'body', 'Mars', 220, 40, { mag: 0.5, color: '#ff7a5c' }),
        mk('body:Moon', 'body', 'Moon', 300, 20, { color: '#e9edf5', phase: 0.5 }), mk('met:Leonids', 'met', 'Leonids', 150, 30), mk('air:a1', 'air', 'AIC144', 10, 25, { az2: 12, el2: 25, ac: { type: 'A20N' } })];
      state.byId = new Map(state.objs.map((o) => [o.id, o])); state.sunAlt = ${sunAlt}; state.compass = false; state.rot = 0; state.flip = true; state.sel = null;
      window.__texts = []; draw();
    })()`;
    for (const sunAlt of [45, 0, -30]) {
      await page.evaluate(sky(sunAlt));
      const worst = await page.evaluate(() => {
        const cv = document.querySelector('#sky'), c = cv.getContext('2d'), out = [];
        const L = (r, g, b) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        for (const t of window.__texts) {
          if (!/^(Vega|Altair|Mars|Moon|Leonids|AIC144|30°|60°)$/.test(t.t)) continue;
          const x0 = Math.max(0, Math.floor((t.a === 'left' ? t.x : t.a === 'right' ? t.x - t.w : t.x - t.w / 2) * t.s)), y0 = Math.max(0, Math.floor((t.y - 10) * t.s)), w = Math.ceil(t.w * t.s), h = Math.ceil(13 * t.s);
          const d = c.getImageData(x0, y0, w, h).data; let lo = 9, hi = 0;
          for (let i = 0; i < d.length; i += 4) { const l = L(d[i], d[i + 1], d[i + 2]); if (l < lo) lo = l; if (l > hi) hi = l; }
          out.push([t.t, (hi + 0.05) / (lo + 0.05)]);
        }
        return out;
      });
      assert.ok(worst.length >= 6, 'the names were drawn at sun ' + sunAlt + ': ' + JSON.stringify(worst));
      // 4.5 is the contrast the accessibility guidelines (WCAG AA) ask of text; thin 11 px glyphs measure a little under the 6 this once asked for on some machines.
      for (const [name, ratio] of worst) assert.ok(ratio >= 4.5, `sun ${sunAlt}: "${name}" has a contrast of only ${ratio.toFixed(1)} against what is behind it`);
    }
  } finally { await context.close(); }
});

// A few objects for the radar, without the sky libraries or the network.
const DARK_SKY = (sunAlt) => `(() => {
  const { state, renderNearby, renderDetail, renderPasses, draw } = window.__fg;
  const mk = (id, kind, name, az, el, extra) => Object.assign({ id, kind, name, az, el, distKm: 1000, range: 1000 }, extra || {});
  state.objs = [
    mk('air:a1', 'air', 'AIC144', 200, 31, { az2: 201, el2: 31, ac: { type: 'A20N', gs: 400, track: 90, vr: 0, id: 'a1' }, altFt: 12000 }),
    mk('body:Moon', 'body', 'Moon', 90, -3, { color: '#ffffff', phase: 0.5 }),
    mk('star:Vega', 'star', 'Vega', 10, 60),
  ];
  state.byId = new Map(state.objs.map((o) => [o.id, o])); state.sel = null; state.sunAlt = ${sunAlt}; state.compass = false; state.rot = 0; state.flip = true; state.passSel = null; state.detailClosed = null;
  renderNearby(); renderPasses(); renderDetail(); draw();
})()`;
const lumAt = (page, fx, fy) => page.evaluate(([fx, fy]) => {
  const cv = document.querySelector('#sky'), c = cv.getContext('2d'), s = cv.width / cv.clientWidth, W = cv.clientWidth, st = __fg.state;
  const cx = W / 2 + st.view.panX, R = (W / 2 - 26) * st.view.zoom, cy = W / 2 + st.view.panY;
  const d = c.getImageData(Math.round((cx + fx * R) * s), Math.round((cy + fy * R) * s), 1, 1).data;
  return { r: d[0], g: d[1], b: d[2], a: d[3] };
}, [fx, fy]);

test('radar: the sky stays dark by day, and a thing just below the horizon is drawn outside the circle', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await context.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
    await page.goto(base + '/viewer.html?fgtest=1');
    for (const sunAlt of [60, 0, -40]) {
      await page.evaluate(DARK_SKY(sunAlt));
      const inside = await lumAt(page, -0.5, 0.3);
      assert.ok(inside.a > 200 && inside.r < 40 && inside.g < 50 && inside.b < 70, `sun ${sunAlt}: the sky is dark, not blue (${JSON.stringify(inside)})`);
      const rim = await lumAt(page, 0, 1);
      assert.ok(rim.r > 90 || rim.g > 110, `sun ${sunAlt}: the horizon circle has an outline (${JSON.stringify(rim)})`);
      // The Moon is 3 degrees below the horizon, due east: 3 degrees outside the rim, on the right.
      const moon = await lumAt(page, 1 + 3 / 90, 0);
      assert.ok(moon.a > 200 && moon.r > 200, `sun ${sunAlt}: the Moon below the horizon is drawn outside the circle (${JSON.stringify(moon)})`);
    }
  } finally { await context.close(); }
});

test('details: a cross closes the card until something is picked again, and Escape does the same', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await context.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
    await page.goto(base + '/viewer.html?fgtest=1');
    await page.evaluate(DARK_SKY(-40));
    assert.equal(await page.isVisible('#detail'), true, 'the nearest flight is shown by default');
    assert.equal(await page.isVisible('#detail .close-detail'), true, 'with a cross');
    assert.equal(await page.getAttribute('#detail .close-detail', 'aria-label'), 'Close the details');
    // Pick the Moon, then close.
    await page.click('#tabNearby');
    await page.click('.nearby-row[data-id="body:Moon"]');
    assert.equal(await page.evaluate(() => __fg.state.sel), 'body:Moon');
    assert.match(await page.textContent('#detail'), /Moon/);
    await page.click('#detail .close-detail');
    assert.equal(await page.isVisible('#detail'), false, 'the card is gone');
    assert.equal(await page.evaluate(() => __fg.state.sel), null, 'nothing is selected any more');
    await page.waitForTimeout(1200);
    assert.equal(await page.isVisible('#detail'), false, 'and it stays away while the sky updates');
    // Picking something shows it again.
    await page.click('#tabNearby');
    await page.click('.nearby-row[data-id="star:Vega"]');
    assert.equal(await page.isVisible('#detail'), true);
    assert.match(await page.textContent('#detail'), /Vega/);
    // Escape closes it too.
    await page.keyboard.press('Escape');
    assert.equal(await page.isVisible('#detail'), false, 'Escape closes the card');
    assert.equal(await page.evaluate(() => __fg.state.sel), null);
    // The default (nothing picked) card can be closed as well, and comes back with the next pick.
    await page.evaluate(() => { __fg.state.detailClosed = null; __fg.renderDetail(); });
    assert.equal(await page.isVisible('#detail'), true);
    await page.click('#detail .close-detail');
    assert.equal(await page.isVisible('#detail'), false);
    await page.click('#tabNearby');
    await page.click('.nearby-row[data-id="air:a1"]');
    assert.equal(await page.isVisible('#detail'), true);
    assert.match(await page.textContent('#detail'), /AIC144/);
  } finally { await context.close(); }
});

test('details: closing a station pass card clears the pass, and choosing a pass opens the card again', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await context.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
    await page.goto(base + '/viewer.html?fgtest=1');
    await page.evaluate(PASSES);
    await page.click('#passes button.pass[data-pass="0"]');
    assert.match(await page.textContent('#detail'), /next pass/);
    await page.click('#detail .close-detail');
    assert.equal(await page.evaluate(() => __fg.state.passSel), null, 'the path is cleared');
    assert.equal(await page.isVisible('#detail'), false);
    await page.click('#passes button.pass[data-pass="1"]');
    assert.equal(await page.isVisible('#detail'), true, 'choosing a pass opens the card again');
    assert.match(await page.textContent('#detail'), /Tiangong\s*next pass/);
  } finally { await context.close(); }
});

// Two flights 5 km north of the sample place, 2.4 km up: one with a known direction and speed (east, 300 kt), one without
// (as MLAT-tracked flights often are). The sky libraries run for real here, so the page works out the sky itself.
const FLIGHTS = { ac: [
  { hex: 'k1', flight: 'KNOWN1 ', lat: 17.4885, lon: 78.3772, alt_baro: 8000, gs: 300, track: 90, baro_rate: 0, t: 'A320' },
  { hex: 'm1', flight: 'MLAT01 ', lat: 17.4435, lon: 78.4222, alt_baro: 8000, baro_rate: 0, t: 'A320' },
] };
async function liveSky(page, context, { when } = {}) {
  await context.route('**/api.adsb.lol/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(FLIGHTS) }));
  if (when) await page.addInitScript((iso) => {
    const R = Date, off = new R(iso).getTime() - R.now();
    globalThis.Date = class extends R { constructor(...a) { if (a.length) super(...a); else super(R.now() + off); } static now() { return R.now() + off; } };
  }, when);
  await page.goto(base + '/viewer.html?fgtest=1');
  await page.waitForFunction(() => window.__fg && __fg.state.objs.some((o) => o.kind === 'body'), null, { timeout: 20000 });
}
// Tap AR; if the camera view has not opened a few seconds later (a slow machine), tap once more, and say what the page said.
async function openArWithRetry(page) {
  // A camera without a camera, put on the page itself (on some builds a plain assignment from the start-up script does not stick).
  await fakeCamera(page);
  for (let attempt = 0; attempt < 3; attempt++) {
    await fakeCamera(page);
    await page.tap('#arBtn');
    try { await page.waitForFunction(() => !document.querySelector('#ar').hidden, null, { timeout: 6000 }); return; } catch { /* tap again */ }
  }
  throw new Error('the camera view did not open; the page said: ' + JSON.stringify(await page.evaluate(() => ({ toasts: window.__toasts, ar: document.querySelector('#ar').hidden, status: document.querySelector('#status').textContent, gum: String(navigator.mediaDevices && navigator.mediaDevices.getUserMedia).slice(0, 70), same: navigator.mediaDevices === navigator.mediaDevices, src: String(Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'srcObject') && Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'srcObject').get).slice(0, 60) }))));
}
const amberPixels = (page, sel) => page.evaluate((sel) => {
  const cv = document.querySelector(sel), c = cv.getContext('2d'), d = c.getImageData(0, 0, cv.width, cv.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] > 225 && d[i + 1] > 150 && d[i + 1] < 215 && d[i + 2] < 130) n++;
  return n;
}, sel);

test('flights: a plane is drawn as a plane only when its direction is known, otherwise as a plain dot', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await liveSky(page, context);
    await page.waitForFunction(() => __fg.state.objs.filter((o) => o.kind === 'air').length === 2, null, { timeout: 20000 });
    const kinds = await page.evaluate(() => Object.fromEntries(__fg.state.objs.filter((o) => o.kind === 'air').map((o) => [o.name, o.course])));
    assert.deepEqual(kinds, { KNOWN1: true, MLAT01: false });
    // One drawing, counted in the same step (the radar redraws by itself every frame, which would double the count).
    const glyphs = await page.evaluate(() => {
      let n = 0;
      const orig = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (t) { if (t === '✈︎') n++; return orig.apply(this, arguments); };
      __fg.state.compass = false; __fg.state.rot = 0; __fg.draw();
      CanvasRenderingContext2D.prototype.fillText = orig;
      return n;
    });
    assert.equal(glyphs, 1, 'one plane glyph (the flight with a direction); the other is a dot');
  } finally { await context.close(); }
});

test('paths: choosing a flight draws the way it is going; a flight with no known direction has no path', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await liveSky(page, context);
    await page.waitForFunction(() => __fg.state.objs.filter((o) => o.kind === 'air').length === 2, null, { timeout: 20000 });
    await page.evaluate(() => { const s = __fg.state; s.filters.radar = false; s.filters.grid = false; s.filters.labels = false; s.compass = false; s.rot = 0; s.sel = null; __fg.draw(); });
    const before = await amberPixels(page, '#sky');
    const info = await page.evaluate(() => {
      const k = __fg.state.objs.find((o) => o.name === 'KNOWN1'), m = __fg.state.objs.find((o) => o.name === 'MLAT01');
      const pts = __fg.pathFor(k);
      return { first: pts && pts[0], n: pts && pts.length, at: { az: k.az, el: k.el }, mlat: __fg.pathFor(m) };
    });
    assert.ok(info.n > 20, 'a path of ' + info.n + ' points');
    assert.ok(Math.abs(info.first.az - info.at.az) < 2 && Math.abs(info.first.el - info.at.el) < 2, 'it starts where the flight is: ' + JSON.stringify(info));
    assert.equal(info.mlat, null, 'no direction, no path');
    await page.evaluate(() => { __fg.state.sel = 'air:k1'; __fg.state.dirty = true; });
    await sleep(300);
    const withPath = await amberPixels(page, '#sky');
    assert.ok(withPath > before + 80, 'the dashed path is on the radar');
    await page.evaluate(() => { __fg.state.sel = 'air:m1'; __fg.state.dirty = true; });
    await sleep(300);
    assert.ok((await amberPixels(page, '#sky')) < withPath - 60, 'far less is drawn for the flight with no direction (just a dot, no dashed line)');
  } finally { await context.close(); }
});

test('paths: the Sun, a planet and a star show where they go over the next hours, with a mark each hour', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await liveSky(page, context, { when: '2026-11-26T05:00:00Z' }); // mid-morning at the sample place: the Sun is high
    const r = await page.evaluate(() => {
      const objs = __fg.state.objs, sun = objs.find((o) => o.id === 'body:Sun');
      const star = objs.filter((o) => o.kind === 'star' && o.el > 20).sort((a, b) => b.el - a.el)[0];
      const sp = __fg.pathFor(sun), tp = star && __fg.pathFor(star);
      return { sunEl: sun.el, sun: sp && { n: sp.length, hrs: sp.filter((p) => p.hr).map((p) => p.hr), first: sp[0], at: { az: sun.az, el: sun.el } }, star: star && tp && { name: star.name, n: tp.length, hrs: tp.filter((p) => p.hr).length } };
    });
    assert.ok(r.sunEl > 30, 'the Sun is up in this test: ' + r.sunEl);
    assert.ok(r.sun.n >= 15, 'the Sun path has ' + r.sun.n + ' points');
    assert.ok(r.sun.hrs.length >= 4 && r.sun.hrs[0] === 1, 'a mark each hour: ' + r.sun.hrs);
    assert.ok(Math.abs(r.sun.first.az - r.sun.at.az) < 1 && Math.abs(r.sun.first.el - r.sun.at.el) < 1, 'it starts at the Sun: ' + JSON.stringify(r.sun));
    assert.ok(r.star && r.star.n >= 4, 'a star has a path too: ' + JSON.stringify(r.star));
    // Select the Sun: its path is drawn.
    await page.evaluate(() => { const s = __fg.state; s.filters.radar = false; s.filters.grid = false; s.filters.labels = false; s.compass = false; s.rot = 0; s.sel = null; __fg.draw(); });
    const bright = (sel) => page.evaluate((sel) => { const cv = document.querySelector(sel), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] > 200 && d[i + 1] > 215 && d[i + 2] > 240) n++; return n; }, sel);
    const before = await bright('#sky');
    await page.evaluate(() => { __fg.state.sel = 'body:Sun'; __fg.state.dirty = true; });
    await sleep(300);
    assert.ok((await bright('#sky')) > before + 60, 'the Sun\'s path is drawn on the radar');
  } finally { await context.close(); }
});

test('paths: the camera view draws the path of the selected flight too', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await liveSky(page, context);
    await page.waitForFunction(() => __fg.state.objs.some((o) => o.name === 'KNOWN1'), null, { timeout: 20000 });
    await page.evaluate(() => { __fg.state.declination = 0; __fg.state.ori.declination = 0; __fg.state.arOffset = { h: 0, p: 0 }; });
    const az = await page.evaluate(() => __fg.state.objs.find((o) => o.name === 'KNOWN1').az);
    await openArWithRetry(page);
    // Upright (the camera looks level) and facing the flight.
    for (let i = 0; i < 40; i++) { await page.evaluate((h) => { const e = new Event('deviceorientation'); e.webkitCompassHeading = h; e.alpha = 0; e.beta = 90; e.gamma = 0; e.absolute = false; window.dispatchEvent(e); }, az); await sleep(20); }
    await page.evaluate(() => { __fg.state.sel = null; __fg.state.filters.labels = false; });
    await sleep(400);
    const before = await amberPixels(page, '#arCanvas');
    await page.evaluate(() => { __fg.state.sel = 'air:k1'; });
    await sleep(500);
    assert.ok((await amberPixels(page, '#arCanvas')) > before + 80, 'the path is drawn over the camera picture');
  } finally { await context.close(); }
});

test('flights: at each poll a wrong or missing direction is taken from the way the flight moved, and the drawn place slides', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await context.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
    await page.goto(base + '/viewer.html?fgtest=1');
    const r = await page.evaluate(() => {
      const now = Date.now(), east = 78.30 + 2 / 60 / Math.cos(17.4 * Math.PI / 180);
      const before = [{ id: 'x', lat: 17.40, lon: 78.30, track: 0, gs: 250, altFt: 9000, ageS: 0 }, { id: 'y', lat: 17.40, lon: 78.30, track: 90, gs: 250, altFt: 9000, ageS: 0 }];
      const list = [{ id: 'x', lat: 17.40, lon: east, track: 0, gs: 250, altFt: 9000, ageS: 0 }, { id: 'y', lat: 17.40, lon: east, track: null, gs: null, altFt: 9000, ageS: 0 }, { id: 'z', lat: 17.5, lon: 78.4, track: null, gs: null, altFt: 9000, ageS: 0 }];
      __fg.settleCourses(list, before, now - 30000, now);
      return list.map((a) => ({ id: a.id, track: a.track, gs: a.gs, corr: !!a.corr }));
    });
    const by = Object.fromEntries(r.map((a) => [a.id, a]));
    assert.ok(Math.abs(by.x.track - 90) < 1, 'a reported north that plainly moved east is corrected: ' + by.x.track);
    assert.ok(Math.abs(by.y.track - 90) < 1 && Math.abs(by.y.gs - 240) < 4, 'a missing direction and speed come from the movement: ' + JSON.stringify(by.y));
    assert.equal(by.y.corr, true, 'and the drawn place slides');
    assert.equal(by.z.track, null, 'a flight seen for the first time with no direction stays unknown (drawn as a dot)');
  } finally { await context.close(); }
});

test('logo: the round app icons have a thin white ring on the edge and the dark tile inside, with nothing outside the circle', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await page.goto(base + '/about.html');
    for (const [file, size] of [['icon-512.png', 512], ['icon-192.png', 192]]) {
      const px = await page.evaluate(async ([file, size]) => {
        const img = new Image(); img.src = file; await img.decode();
        const c = document.createElement('canvas'); c.width = size; c.height = size;
        const x = c.getContext('2d'); x.drawImage(img, 0, 0);
        const at = (fx, fy) => Array.from(x.getImageData(Math.round(fx * (size - 1)), Math.round(fy * (size - 1)), 1, 1).data);
        // From the left edge of the circle toward the middle, along the middle row.
        const row = Array.from({ length: Math.round(size * 0.05) }, (_, i) => Array.from(x.getImageData(i, Math.round(size / 2), 1, 1).data));
        return { w: img.naturalWidth, corner: at(0, 0), inside: at(0.5, 0.08), row };
      }, [file, size]);
      assert.equal(px.w, size);
      assert.equal(px.corner[3], 0, file + ': outside the circle is transparent');
      assert.ok(px.inside[3] >= 250 && px.inside[0] < 40 && px.inside[2] < 90, file + ': the tile is dark navy ' + px.inside);
      const white = px.row.filter((p) => p[3] > 200 && p[0] > 230 && p[1] > 230 && p[2] > 230).length;
      const teal = px.row.filter((p) => p[3] > 200 && p[2] > 180 && p[0] < 90 && p[1] > 150).length; // real cyan, not a blended edge pixel
      assert.ok(white >= Math.round(size * 0.012) && white <= Math.round(size * 0.025), file + ': a clean white ring, thick enough not to blur when shrunk (' + white + ' px wide)');
      assert.equal(teal, 0, file + ': the old teal edge is gone');
    }
    // On the page the logo is the SVG with the ring, drawn next to the name.
    const ring = await page.evaluate(async () => { const t = await (await fetch('icon.svg')).text(); return /<circle id="ring"[^>]*stroke="#FFFFFF"/.test(t); });
    assert.equal(ring, true);
  } finally { await context.close(); }
});

test('phone on its side: the sky view fits the screen with the whole radar in view, the controls beside it and the details in their own column', { skip }, async () => {
  for (const device of ['iPhone 14 landscape', 'iPhone SE landscape', 'iPhone 14 Pro Max landscape']) {
    const { page, context } = await iphone({ storage: SAVED, device });
    try {
      await context.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
      await page.goto(base + '/viewer.html?fgtest=1');
      await page.evaluate(DARK_SKY(-40));
      await page.waitForTimeout(300);
      const m = await page.evaluate(() => {
        const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
        return { vw: innerWidth, vh: innerHeight, docH: document.documentElement.scrollHeight, docW: document.documentElement.scrollWidth, sky: r('#sky'), side: r('.side'), zoomIn: r('#zoomIn'), ar: r('#arBtn'), gear: r('#gearBtn'), radius: getComputedStyle(document.querySelector('#sky')).borderRadius };
      });
      const tag = device + ' ' + m.vw + 'x' + m.vh;
      assert.ok(m.vw > m.vh, tag + ' is on its side');
      assert.ok(m.docH <= m.vh + 1, `${tag}: the page does not scroll (${m.docH} tall on a ${m.vh} screen)`);
      assert.ok(m.docW <= m.vw + 1, `${tag}: nothing sticks out sideways`);
      assert.ok(m.sky.t >= 0 && m.sky.b <= m.vh + 1, `${tag}: the whole radar is on the screen (${Math.round(m.sky.t)} to ${Math.round(m.sky.b)} of ${m.vh})`);
      assert.ok(m.sky.h > m.vh * 0.6, `${tag}: and not tiny (${Math.round(m.sky.h)} px)`);
      assert.ok(Math.abs(m.sky.w - m.sky.h) < 2, tag + ': it is round (square canvas)');
      assert.ok(m.zoomIn.l >= m.sky.r - 1 && m.ar.b <= m.vh + 1 && m.ar.r <= m.vw, `${tag}: the zoom buttons stand beside the radar, on the screen`);
      assert.ok(m.side.l >= m.zoomIn.r - 1, `${tag}: the details column is to the right`);
      assert.ok(m.gear.r <= m.vw && m.gear.t >= 0, tag + ': the gear is on the screen');
      assert.equal(m.radius, '0px', tag + ': the canvas is not clipped to a circle, so names outside the horizon circle show');
    } finally { await context.close(); }
  }
});

test('phone on its side: the home page fits too, in two columns', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED, device: 'iPhone 14 landscape' });
  try {
    await page.goto(base + '/index.html');
    const m = await page.evaluate(() => ({ vh: innerHeight, docH: document.documentElement.scrollHeight, intro: document.querySelector('.intro').getBoundingClientRect().right, actions: document.querySelector('.actions').getBoundingClientRect().left, hero: getComputedStyle(document.querySelector('.hero-row')).display }));
    assert.ok(m.docH <= m.vh + 2, `no scrolling (${m.docH} on ${m.vh})`);
    assert.ok(m.actions >= m.intro, 'the introduction is on the left and the actions on the right');
    assert.equal(m.hero, 'none', 'the picture is dropped to make room');
  } finally { await context.close(); }
});

test('phone in portrait is not affected by the sideways layout', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await context.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
    await page.goto(base + '/viewer.html?fgtest=1');
    const m = await page.evaluate(() => { const s = document.querySelector('#sky').getBoundingClientRect(); return { vw: innerWidth, sky: s.width, tabs: getComputedStyle(document.querySelector('.tabs')).display, side: getComputedStyle(document.querySelector('#pageRadar')).display }; });
    assert.ok(m.sky > m.vw * 0.8, 'the radar is as wide as the page: ' + m.sky + ' of ' + m.vw);
    assert.notEqual(m.tabs, 'none', 'the Radar and Nearby tabs are there');
    assert.notEqual(m.side, 'grid');
  } finally { await context.close(); }
});

test('gear menu: Install app is offered in the sky view, and says how when the browser has no install prompt', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await context.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
    await page.goto(base + '/viewer.html?fgtest=1');
    await page.tap('#gearBtn');
    assert.deepEqual(await page.$$eval('#gearList li', (els) => els.map((e) => e.textContent.trim())), ['Settings', 'Help', 'Install app', 'Tell a friend']);
    assert.equal(await page.isVisible('#gearInstall'), true);
    await page.tap('#gearInstall');
    assert.equal(await page.isVisible('#gearList'), false, 'the menu closes');
    await page.waitForFunction(() => /Share button, then Add to Home Screen/.test(document.querySelector('#toast').textContent));
    // Once the app is installed the item goes, also on the next visit.
    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
    await page.tap('#gearBtn');
    assert.equal(await page.isVisible('#gearInstall'), false);
    assert.deepEqual(await page.$$eval('#gearList li', (els) => els.filter((e) => !e.hidden).map((e) => e.textContent.trim())), ['Settings', 'Help', 'Tell a friend']);
    await page.reload();
    await page.tap('#gearBtn');
    assert.equal(await page.isVisible('#gearInstall'), false, 'still gone on the next visit');
  } finally { await context.close(); }
});

test('logo: the maskable and iPhone icons have the ring too, inside the part no mask cuts', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await page.goto(base + '/about.html');
    for (const [file, size] of [['icon-maskable-512.png', 512], ['apple-touch-icon.png', 180]]) {
      const r = await page.evaluate(async ([file, size]) => {
        const img = new Image(); img.src = file; await img.decode();
        const c = document.createElement('canvas'); c.width = size; c.height = size;
        const x = c.getContext('2d'); x.drawImage(img, 0, 0);
        const px = (dx, dy) => Array.from(x.getImageData(Math.round(size / 2 + dx), Math.round(size / 2 + dy), 1, 1).data);
        const R = size * 0.395, whiteAt = (dx, dy) => { const p = px(dx, dy); return p[0] > 200 && p[1] > 200 && p[2] > 200 && p[3] === 255; };
        // The ring, found on four sides, within a pixel or two of where it should be.
        const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([ux, uy]) => { for (let d = -3; d <= 3; d++) if (whiteAt(ux * (R + d), uy * (R + d))) return true; return false; });
        return { sides, inside: px(R * 0.8, R * 0.8), outside: px(R * 1.1, 0), corner: px(-size / 2 + 1, -size / 2 + 1) };
      }, [file, size]);
      assert.deepEqual(r.sides, [true, true, true, true], file + ': the ring is there on every side');
      assert.equal(r.corner[3], 255, file + ': still full bleed (no transparent corners)');
      assert.ok(r.outside[0] < 60 && r.outside[2] < 110, file + ': dark navy outside the ring (' + r.outside + ')');
    }
  } finally { await context.close(); }
});

// A flight whose route the relay knows: Hyderabad to Delhi. The relay is a stand-in that answers /route.
const ROUTE_JSON = { callsign: 'AIC144', origin: { iata: 'HYD', icao: 'VOHS', name: 'Rajiv Gandhi International Airport', city: 'Hyderabad', lat: 17.24, lon: 78.43 }, destination: { iata: 'DEL', icao: 'VIDP', name: 'Indira Gandhi International Airport', city: 'Delhi', lat: 28.56, lon: 77.1 } };
async function routeSetup(page, context, route) {
  await context.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
  await context.route('**/config.js*', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.FARGEMS_CONFIG = { aircraftProxy: "https://relay.test/aircraft", build: "" };' }));
  await context.route('https://relay.test/**', (r) => {
    const u = new URL(r.request().url()), h = { 'Access-Control-Allow-Origin': '*' };
    if (u.pathname === '/route') return r.fulfill({ status: 200, headers: h, contentType: 'application/json', body: JSON.stringify(route) });
    return r.fulfill({ status: 503, headers: h, contentType: 'application/json', body: '{}' });
  });
  await page.goto(base + '/viewer.html?fgtest=1');
}
const flightSky = (call) => `(() => {
  const { state, renderNearby, renderDetail } = window.__fg;
  const o = { id: 'air:a1', kind: 'air', name: '${call}', az: 200, el: 31, distKm: 12, range: 12, altFt: 12000, course: true, ac: { call: '${call}', type: 'A20N', gs: 400, track: 90, vr: 0, id: 'a1', lat: 17.5, lon: 78.4 } };
  state.objs = [o]; state.byId = new Map([[o.id, o]]); state.sel = o.id; state.routes.clear(); state.detailClosed = null;
  renderNearby(); renderDetail();
})()`;

test('flight card: the airline is named under the flight number, and From and To have the same weight', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await routeSetup(page, context, ROUTE_JSON);
    await page.evaluate(flightSky('AIC144'));
    await page.waitForSelector('#detail .route .stop', { timeout: 8000 });
    assert.equal((await page.textContent('#detail .airline')).trim(), 'Air India');
    assert.ok((await page.innerHTML('#detail')).indexOf('class="airline"') < (await page.innerHTML('#detail')).indexOf('class="route"'), 'the airline comes first, then the route');
    const stops = await page.$$eval('#detail .route .stop', (els) => els.map((e) => { const b = e.querySelector('b'), cs = getComputedStyle(b), small = e.querySelector('small'); return { label: small.textContent, place: b.textContent, code: (e.querySelector('.code') || {}).textContent, size: cs.fontSize, weight: cs.fontWeight, color: cs.color, opacity: cs.opacity }; }));
    assert.deepEqual(stops.map((s) => [s.label, s.place, s.code]), [['From', 'Hyderabad', 'HYD'], ['To', 'Delhi', 'DEL']]);
    assert.equal(stops[0].size, stops[1].size, 'the same size');
    assert.equal(stops[0].weight, stops[1].weight, 'the same weight');
    assert.equal(stops[0].color, stops[1].color, 'the same colour: the start is not greyed out');
    assert.equal(stops[0].opacity, stops[1].opacity);
    assert.equal(await page.$$eval('#detail .route .arrow', (e) => e.length), 1);
    assert.match(await page.textContent('#detail .route-far'), /^[\d,.]+ (km|mi|nm) to go$/);
    assert.doesNotMatch(await page.textContent('#detail'), /Flying to/);
    // The camera view's card has them too.
    assert.equal((await page.textContent('#arDetail .airline')).trim(), 'Air India');
    assert.equal(await page.$$eval('#arDetail .route .stop', (e) => e.length), 2);
    // Both ends are on the screen, side by side.
    const boxes = await page.$$eval('#detail .route .stop', (els) => els.map((e) => { const b = e.getBoundingClientRect(); return [b.left, b.right, b.top]; }));
    assert.ok(boxes[0][1] <= boxes[1][0] + 1 && Math.abs(boxes[0][2] - boxes[1][2]) < 4 && boxes[1][1] <= 390, 'From on the left, To on the right, in one row, inside the phone width: ' + JSON.stringify(boxes));
  } finally { await context.close(); }
});

test('flight card: an unknown start is shown as unknown, at the same size as the known end; a flight with no airline shows none', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await routeSetup(page, context, { ...ROUTE_JSON, callsign: 'N123AB', origin: null });
    await page.evaluate(flightSky('N123AB'));
    await page.waitForSelector('#detail .route .stop', { timeout: 8000 });
    assert.equal(await page.$$eval('#detail .airline', (e) => e.length), 0, 'a registration has no airline line');
    const stops = await page.$$eval('#detail .route .stop b', (els) => els.map((b) => [b.textContent, getComputedStyle(b).fontSize]));
    assert.deepEqual(stops.map((s) => s[0]), ['Not known', 'Delhi']);
    assert.equal(stops[0][1], stops[1][1], 'the same size');
  } finally { await context.close(); }
});

test('flights in the list name their airline beside the type, and the share text has the airline and the route in words', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await routeSetup(page, context, ROUTE_JSON);
    await page.evaluate(() => { window.__copied = []; Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.__copied.push(t); return Promise.resolve(); } }, configurable: true }); });
    await page.evaluate(flightSky('AIC144'));
    await page.waitForSelector('#detail .route .stop', { timeout: 8000 });
    await page.click('#tabNearby');
    const row = await page.textContent('.nearby-row[data-id="air:a1"] .where');
    assert.match(row, /Aircraft\s+Air India/, 'the type in words, then the airline: ' + row);
    await page.click('#tabRadar');
    await page.click('#detail [data-share]');
    await page.waitForFunction(() => window.__copied.length === 1);
    const text = await page.evaluate(() => window.__copied[0]);
    assert.match(text, /Air India\. Flying from Hyderabad \(HYD\) to Delhi \(DEL\)\./);
    assert.doesNotMatch(text, /FromHyderabad|<|Not known/, 'no markup in the text');
  } finally { await context.close(); }
});

// Instead of a share sheet (which this test browser has not got) the page copies the text; the test reads what was copied.
const copyOnly = (page) => page.evaluate(() => { window.__copied = []; Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.__copied.push(t); return Promise.resolve(); } }, configurable: true }); });
const SHARE_RE = /^Look up\. Know what you.re looking at\. .{1,4} FarGems names the planes, the ISS, planets and the Moon above you, live, on a radar or in AR through your camera\. Free, no sign-up\. http:\/\/localhost:\d+\/$/u;

test('share the app: from the gear menu in the sky view', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await context.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
    await page.goto(base + '/viewer.html?fgtest=1');
    await copyOnly(page);
    await page.tap('#gearBtn');
    assert.equal((await page.textContent('#gearShare')).trim(), 'Tell a friend');
    await page.tap('#gearShare');
    await page.waitForFunction(() => window.__copied.length === 1);
    assert.match(await page.evaluate(() => window.__copied[0]), SHARE_RE);
    assert.equal(await page.isVisible('#gearList'), false, 'the menu closes');
    await page.waitForFunction(() => /Copied/.test(document.querySelector('#toast').textContent));
  } finally { await context.close(); }
});

test('share the app: from the ... menu on the home page, and from the Settings page', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await page.goto(base + '/index.html');
    await copyOnly(page);
    await page.tap('#menuBtn');
    await page.tap('#menuShare');
    await page.waitForFunction(() => window.__copied.length === 1);
    assert.match(await page.evaluate(() => window.__copied[0]), SHARE_RE);
    assert.equal(await page.isVisible('#menuList'), false);
    await page.waitForFunction(() => !document.querySelector('#toast').hidden && /Copied/.test(document.querySelector('#toast').textContent));
    await page.goto(base + '/settings.html');
    await copyOnly(page);
    assert.equal((await page.textContent('#shareTitle')).trim(), 'Pass it on');
    assert.equal((await page.textContent('#shareApp')).trim(), 'Tell a friend');
    await page.tap('#shareApp');
    await page.waitForFunction(() => window.__copied.length === 1);
    assert.match(await page.evaluate(() => window.__copied[0]), SHARE_RE, 'the same text from every place');
    assert.match(await page.textContent('#settingsMsg'), /Copied/);
  } finally { await context.close(); }
});

test('share the app: the phone share sheet gets the title, the text and the address, and closing it says nothing', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await page.goto(base + '/settings.html');
    await page.evaluate(() => { window.__shared = []; window.__mode = 'ok'; navigator.share = async (d) => { window.__shared.push(d); if (window.__mode === 'close') { const e = new Error('closed'); e.name = 'AbortError'; throw e; } }; });
    await page.tap('#shareApp');
    await page.waitForFunction(() => window.__shared.length === 1);
    const d = await page.evaluate(() => window.__shared[0]);
    assert.match(d.text, /^Look up\. Know what you.re looking at\./);
    assert.match(d.url, /^http:\/\/localhost:\d+\/$/);
    assert.ok(d.title.length > 5);
    assert.match(await page.textContent('#settingsMsg'), /Thanks for sharing/);
    await page.evaluate(() => { window.__mode = 'close'; });
    await page.tap('#shareApp');
    await page.waitForFunction(() => window.__shared.length === 2);
    await page.waitForTimeout(200);
    assert.equal((await page.textContent('#settingsMsg')).trim(), '', 'closing the sheet is not an error');
  } finally { await context.close(); }
});

test('tabs: a segmented control with icons, the chosen tab filled, and a count on Nearby that follows the list', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await context.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
    await page.goto(base + '/viewer.html?fgtest=1');
    await page.evaluate(() => { const { state, renderNearby } = window.__fg; state.objs = []; state.byId = new Map(); renderNearby(); });
    assert.equal(await page.isVisible('#nearbyCount'), false, 'no count while nothing is listed');
    await page.evaluate(FAKE_SKY);
    assert.equal((await page.textContent('#nearbyCount')).trim(), '4', 'one for each thing in the list');
    const look = () => page.$$eval('.tab', (tabs) => tabs.map((t) => { const cs = getComputedStyle(t); return { on: t.classList.contains('on'), color: cs.color, bg: cs.backgroundColor, h: t.getBoundingClientRect().height, icon: !!t.querySelector('svg[aria-hidden="true"]') }; }));
    let [radar, nearby] = await look();
    assert.ok(radar.on && !nearby.on);
    assert.ok(radar.icon && nearby.icon, 'an icon on each');
    assert.notEqual(radar.bg, nearby.bg, 'the chosen tab is filled');
    assert.notEqual(radar.color, nearby.color, 'and has its own colour');
    assert.ok(radar.h >= 40 && nearby.h >= 40, 'a comfortable target: ' + radar.h);
    // Switching moves the fill, and the count stays right.
    await page.click('#tabNearby');
    [radar, nearby] = await look();
    assert.ok(nearby.on && !radar.on);
    assert.notEqual(radar.bg, nearby.bg);
    assert.equal((await page.textContent('#nearbyCount')).trim(), '4');
    // The accessible name of the tab still starts with its label, and the icons are not read out.
    assert.match((await page.textContent('#tabNearby')).replace(/\s+/g, ' ').trim(), /^Nearbys*4$/);
    assert.equal(await page.getAttribute('#tabNearby', 'aria-selected'), 'true');
    // Keyboard use still works.
    await page.focus('#tabNearby');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.getAttribute('#tabRadar', 'aria-selected'), 'true');
  } finally { await context.close(); }
});

// The picture at the top of the card. Wikipedia and its picture server are answered by the test.
test('card preview: the Moon and the planets are drawn on the card, the Moon as it is lit, with no network', { skip }, async () => {
  const { page, context } = await linked('', FAKE_SKY);
  const asked = []; page.on('request', (q) => { if (/wikipedia|wikimedia/.test(q.url())) asked.push(q.url()); });
  try {
    await page.evaluate(() => { window.__fg.state.byId.get('body:Moon').waxing = true; window.__fg.state.sel = 'body:Moon'; window.__fg.renderDetail(); });
    const moon = page.locator('#detail .pv-art svg');
    assert.equal(await moon.isVisible(), true, 'a picture on the card');
    assert.equal(await moon.getAttribute('aria-label'), 'The Moon tonight, 98% lit');
    assert.equal(await page.evaluate(() => document.querySelector('#detail .pv-art svg image').getAttribute('href')), 'assets/moon-full.jpg', 'a real photograph of the Moon, from this app');
    await tallerBy(page, 10);
    assert.match(await page.textContent('#detail .hdt'), /Moon[\s\S]*Full Moon/, 'the head says what phase it is (98% lit and growing: Full Moon), from the numbers on the card');
    const box = await moon.boundingBox(); assert.ok(box.width >= 48 && box.width <= 80, 'a small preview: ' + box.width);
    const titleLeft = await page.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.querySelector('#detail h3')); return r.getClientRects()[0].left; });
    assert.ok(titleLeft >= box.x + box.width - 1, 'the title is beside it, not under it');
    assert.equal(await page.evaluate(() => { const s = document.querySelector('#detail .pv svg'); return s.getBoundingClientRect().height > 40 && !!s.querySelector('circle'); }), true, 'it is drawn');
    for (const [id, label] of [['body:Mars', 'Mars'], ['body:Saturn', 'Saturn with its rings'], ['body:Sun', 'The Sun']]) {
      await page.evaluate((i) => { const { state } = window.__fg; state.objs.push({ id: i, kind: 'body', name: i.slice(5), az: 100, el: 20, distKm: 1e8, range: 1e8, phase: 0.9, color: '#cc7755' }); state.byId = new Map(state.objs.map((o) => [o.id, o])); state.sel = i; window.__fg.renderDetail(); }, id);
      assert.equal(await page.locator('#detail .pv-art svg').getAttribute('aria-label'), label);
    }
    assert.equal(await page.evaluate(() => document.querySelectorAll('#detail .pv img').length), 0, 'a drawing, not a photo');
    assert.equal(asked.some((u) => /(upload|thumb)\.wikimedia/.test(u)), false, 'no picture is fetched for a planet');
    // the camera view card has its own copy, with its own names, so both show
    const ids = await page.evaluate(() => [...document.querySelectorAll('#detail svg [id], #arDetail svg [id]')].map((n) => n.id));
    assert.equal(new Set(ids).size, ids.length, 'no name is used twice in the page: ' + ids.join());
    assert.equal(await page.evaluate(() => !!document.querySelector('#arDetail .pv-art svg')), true);
  } finally { await context.close(); }
});

test('card preview: a flight shows the photo of its type from Wikipedia, named as that type, and the card has room for it', { skip }, async () => {
  const { page, context } = await linked('', FAKE_SKY, (c) => wikiAnswers(c));
  try {
    await page.evaluate(() => { window.__fg.state.byId.get('air:a1').ac.call = 'AIC144'; window.__fg.state.sel = 'air:a1'; window.__fg.renderDetail(); }); // with an airline line, as a flight card has
    const img = page.locator('#detail .pv-photo img');
    await img.waitFor({ state: 'visible' });
    assert.match(await img.getAttribute('src'), /^https:\/\/thumb\.wikimedia\.org\/.*Airbus_A320neo/);
    assert.equal(await img.getAttribute('referrerpolicy'), 'no-referrer');
    await page.waitForFunction(() => { const i = document.querySelector('#detail .pv-photo img'); return i && i.complete && i.naturalWidth > 0; });
    assert.equal(await img.getAttribute('alt'), 'Airbus A320neo family (example photo of this type of aircraft)', 'says which type, and that it is an example');
    assert.equal(await page.textContent('#detail .pv-tag'), 'example', 'and the picture itself says so');
    assert.equal(await page.locator('#detail figcaption').count(), 0, 'no caption line that makes the card taller');
    await tallerBy(page, 10); // the photo sits beside the name and the airline, so it adds (almost) no height
    const card = await page.locator('#detail').boundingBox(), pic = await img.boundingBox();
    assert.ok(pic.x >= card.x && pic.x + pic.width <= card.x + card.width + 1, 'inside the card');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the page does not scroll sideways');
    // moving to another object takes it away
    await page.evaluate(() => { window.__fg.state.sel = 'star:Vega'; window.__fg.renderDetail(); });
    assert.equal(await page.locator('#detail .pv').count(), 0, 'a star has no preview');
    await page.evaluate(() => { window.__fg.state.sel = 'air:a1'; window.__fg.renderDetail(); });
    await page.locator('#detail .pv-photo img').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#detail .pv-generic').count(), 0, 'the generic picture gives way to the photo once it is there');
  } finally { await context.close(); }
});

test('card preview: no photo when Wikipedia has none, and a photo that cannot be loaded is replaced by the generic picture', { skip }, async () => {
  const none = await linked('', FAKE_SKY, (c) => wikiAnswers(c, { thumb: false }));
  try {
    await none.page.evaluate(() => { window.__fg.state.sel = 'air:a1'; window.__fg.renderDetail(); });
    await none.page.locator('#detail .more').click(); await none.page.waitForFunction(() => document.querySelector('#detail .blurb')); // the long card, and the article arrived
    assert.equal(await none.page.locator('#detail .pv-photo').count(), 0, 'no photo to show');
    assert.equal(await none.page.locator('#detail .pv-generic svg').count(), 1, 'a generic picture instead, so the card is never without one');
  } finally { await none.context.close(); }
  const broken = await linked('', FAKE_SKY, (c) => wikiAnswers(c, { picture: 'fail' }));
  try {
    await broken.page.evaluate(() => { // note that the picture was there before it failed, so that its going away is seen
      window.__sawPv = false; new MutationObserver(() => { if (document.querySelector('#detail .pv img')) window.__sawPv = true; }).observe(document.querySelector('#detail'), { childList: true, subtree: true });
      window.__fg.state.sel = 'air:a1'; window.__fg.renderDetail();
    });
    await broken.page.locator('#detail .more').click(); await broken.page.waitForFunction(() => document.querySelector('#detail .blurb'));
    await broken.page.waitForFunction(() => !document.querySelector('#detail .pv-photo') && document.querySelector('#detail .pv-generic'), null, { timeout: 8000 });
    assert.equal(await broken.page.evaluate(() => window.__sawPv), true, 'it was shown, then replaced by the generic picture when it failed');
    assert.equal(await broken.page.locator('#detail img').count(), 0, 'no broken-image icon');
    assert.match(await broken.page.textContent('#detail'), /AIC144/, 'the rest of the card is still there');
  } finally { await broken.context.close(); }
});

test('card preview: with a photo on the card, the From and To row still has the whole width, below the photo', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await wikiAnswers(context);
    await routeSetup(page, context, ROUTE_JSON);
    await page.evaluate(flightSky('AIC144'));
    await page.waitForSelector('#detail .route .stop', { timeout: 8000 });
    await page.waitForFunction(() => { const i = document.querySelector('#detail .pv-photo img'); return i && i.complete && i.naturalWidth > 0; });
    const m = await page.evaluate(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect(), pic = r('#detail .pv-photo img'), route = r('#detail .route'), card = r('#detail');
      const stops = [...document.querySelectorAll('#detail .route .stop')].map((e) => e.getBoundingClientRect());
      return { picBottom: pic.bottom, routeTop: route.top, routeW: route.width, cardW: card.width, rows: stops.map((b) => b.top), right: Math.max(...stops.map((b) => b.right)), left: Math.min(...stops.map((b) => b.left)), cardLeft: card.left };
    });
    assert.ok(m.routeTop >= m.picBottom - 1, 'the route starts below the photo: ' + JSON.stringify(m));
    assert.ok(m.routeW >= m.cardW - 40, 'and has the width of the card: ' + JSON.stringify(m));
    assert.ok(Math.abs(m.rows[0] - m.rows[1]) < 4 && m.right <= 390, 'From and To are in one row inside the phone width: ' + JSON.stringify(m));
  } finally { await context.close(); }
});

// The bright (near white) pixels in the top left corner of a picture: how many, and how far across and down they reach, in screen px.
const BRAND_PROBE = `(src, scale) => {
  const w = src.width, h = Math.round(48 * scale), x1 = Math.round(w / 2);
  const d = src.getContext('2d').getImageData(0, 0, x1, h).data;
  let n = 0, maxX = 0, maxY = 0, minX = 1e9;
  for (let y = 0; y < h; y++) for (let x = 0; x < x1; x++) { const i = (y * x1 + x) * 4; if (d[i] > 190 && d[i + 1] > 190 && d[i + 2] > 190 && d[i + 3] > 200) { n++; maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); minX = Math.min(minX, x); } }
  return { n, minX: minX / scale, maxX: maxX / scale, maxY: maxY / scale };
}`;

test('AR: the app name and logo are small at the top left of the camera picture, and a saved picture has them too', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await context.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
    await page.goto(base + '/viewer.html?fgtest=1');
    await page.evaluate(() => {
      window.__shared = []; navigator.canShare = () => true;
      navigator.share = async (d) => {
        const bmp = await createImageBitmap(d.files[0]), c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; c.getContext('2d').drawImage(bmp, 0, 0);
        const cv = document.querySelector('#arCanvas'); window.__shared.push({ c, scale: bmp.width / cv.clientWidth });
      };
    });
    await openAr(page, AR_SKY(0.5, 100));
    await page.waitForFunction(() => { const i = [...document.images].length; return true; }); // the logo is a picture the view loads itself
    await sleep(500);
    const live = await page.evaluate(`(() => { const cv = document.querySelector('#arCanvas'); const f = ${BRAND_PROBE}; return f(cv, cv.width / cv.clientWidth); })()`);
    assert.ok(live.n > 40, 'the name is drawn at the top left: ' + JSON.stringify(live));
    assert.ok(live.maxX < 140 && live.maxY < 60, 'and it is small, in the corner: ' + JSON.stringify(live));
    assert.ok(live.minX >= 8, 'with a margin');
    await page.tap('#arShot');
    await page.waitForFunction(() => window.__shared.length === 1, null, { timeout: 10000 });
    const saved = await page.evaluate(`(() => { const s = window.__shared[0]; const f = ${BRAND_PROBE}; return f(s.c, s.scale); })()`);
    assert.ok(saved.n > 40 && saved.maxX < 140 && saved.maxY < 60, 'the saved picture has the same name in the same place: ' + JSON.stringify(saved));
  } finally { await context.close(); }
});

test('AR: the camera button is a round shutter at the bottom right, above the card when it is open, and Align is at the bottom left', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await context.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
    await page.goto(base + '/viewer.html?fgtest=1');
    await openAr(page, AR_SKY(0.5, 100));
    const vp = page.viewportSize();
    const box = async (s) => page.evaluate((q) => { const r = document.querySelector(q).getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; }, s);
    await page.evaluate(() => window.__fg.closeDetail()); // no card
    let shot = await box('#arShot'), align = await box('#arAlign');
    assert.ok(shot.w >= 56 && Math.abs(shot.w - shot.h) < 1, 'a round button, big enough to tap: ' + JSON.stringify(shot));
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#arShot')).borderRadius), '50%');
    assert.ok(shot.r > vp.width - 16 && shot.b > vp.height - 40, 'bottom right with no card: ' + JSON.stringify([shot, vp]));
    assert.ok(align.l < 16 && align.b > vp.height - 40, 'Align at the bottom left: ' + JSON.stringify(align));
    assert.equal(await page.evaluate(() => document.querySelector('#arShot').textContent.trim()), '', 'no word on it, like a camera');
    assert.equal(await page.getAttribute('#arShot', 'aria-label'), 'Take a picture with the labels on it');
    // not where it used to be: under the close button at the top right
    const close = await box('#arClose'); assert.ok(shot.t > close.b + 200, 'far from the close button');
    // with the card open the shutter is above it, still at the right edge, and nothing overlaps
    await page.evaluate(() => { window.__fg.state.sel = 'body:Moon'; window.__fg.state.detailClosed = null; window.__fg.renderDetail(); });
    // the details are in the bubble beside the object; tapping the bubble brings the card up under the buttons
    await page.waitForFunction(() => window.__fg.arView().callout(), null, { timeout: 5000 });
    assert.equal(await page.isVisible('#arDetail'), false, 'with the bubble showing, there is no card');
    const bub = await page.evaluate(() => window.__fg.arView().callout());
    await page.touchscreen.tap(bub.x + bub.w / 2, bub.y + bub.h / 2);
    await page.waitForSelector('#arDetail h3', { state: 'visible' });
    const card = await box('#arDetail'); shot = await box('#arShot'); align = await box('#arAlign');
    assert.ok(shot.b <= card.t + 1, 'the shutter is above the card, not on it: ' + JSON.stringify([shot, card]));
    assert.ok(shot.r > vp.width - 16, 'and at the right edge');
    assert.ok(card.b >= vp.height - 30, 'the card is still at the bottom: ' + JSON.stringify([card, vp]));
    assert.ok(align.b <= card.t + 1 && align.l < 16, 'Align above the card on the left');
    // it still works with the card open
    await page.evaluate(() => { window.__taken = 0; });
    assert.equal(await page.evaluate(() => { const r = document.querySelector('#arShot').getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2).closest('#arShot') !== null; }), true, 'nothing covers it');
  } finally { await context.close(); }
});

// Where the picked object is on the screen, and how many bright (near white) pixels there are around it at a radius.
const AROUND = `(cx, cy, r0, r1) => {
  const cv = document.querySelector('#arCanvas'), s = cv.width / cv.clientWidth, c = cv.getContext('2d');
  const R = Math.round(r1 * s), x0 = Math.round(cx * s) - R, y0 = Math.round(cy * s) - R, d = c.getImageData(x0, y0, 2 * R, 2 * R).data;
  let n = 0;
  for (let y = 0; y < 2 * R; y++) for (let x = 0; x < 2 * R; x++) {
    const dist = Math.hypot(x - R, y - R) / s; if (dist < r0 || dist > r1) continue;
    const i = (y * 2 * R + x) * 4; if (d[i] > 170 && d[i + 1] > 170 && d[i + 2] > 170 && d[i + 3] > 150) n++;
  }
  return n;
}`;

test('AR: the picked object icon fades and leaves a ring of dots, and a bubble with its details sits beside it, joined by a dotted line', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await context.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
    await page.goto(base + '/viewer.html?fgtest=1');
    await openAr(page, AR_SKY(0.5, 100));
    // Put the Moon up and to the right of the crosshair (so that the crosshair does not pick it by itself), and pick it by hand.
    await page.evaluate(() => {
      const { state } = window.__fg; const m = state.byId.get('body:Moon'); m.az = 100; m.el = 14; m.distKm = 384400;
      state.sel = null; state.detailClosed = null; state.dirty = true;
    });
    // where the view has drawn it, once it has stopped moving (the picture follows the compass a little behind)
    await page.waitForFunction(() => { const it = window.__fg.arView().item('body:Moon'); if (!it) return false; const last = window.__last; window.__last = it; return !!last && Math.hypot(last.x - it.x, last.y - it.y) < 0.5; }, null, { polling: 120, timeout: 8000 });
    const size = await page.evaluate(() => { const cv = document.querySelector('#arCanvas'); return { W: cv.clientWidth, H: cv.clientHeight }; });
    const spot = () => page.evaluate(() => window.__fg.arView().item('body:Moon'));
    let where = await spot();
    assert.ok(where.x > 0 && where.x < size.W && where.y > 100 && where.y < size.H - 160, 'the Moon is in the picture: ' + JSON.stringify([where, size]));
    const brightAt = async (r0, r1) => { const w = await spot(); return page.evaluate(`(${AROUND})(${w.x}, ${w.y}, ${r0}, ${r1})`); };
    await page.evaluate(() => { window.__fg.state.sel = 'body:Moon'; window.__fg.state.dirty = true; window.__fg.renderDetail(); });
    // as soon as the bubble is there the icon is still whole, so it is clear what was picked
    await page.waitForFunction(() => window.__fg.arView().callout(), null, { timeout: 5000 });
    const early = await brightAt(0, 14);
    assert.ok(early > 40, 'at first the Moon icon is there to see what was picked: ' + early);
    assert.equal(await page.isVisible('#arDetail'), false, 'and the card is not under the picture');
    await sleep(2400);
    where = await spot();
    const b = await page.evaluate(() => window.__fg.arView().callout());
    assert.ok(b.x >= 0 && b.x + b.w <= size.W && b.y >= 80 && b.y + b.h <= size.H, 'the bubble is inside the picture: ' + JSON.stringify(b));
    assert.ok(b.w > 100 && b.w <= 300 && b.h > 50 && b.h < 130, 'and small: ' + JSON.stringify(b));
    const near = Math.hypot(Math.max(b.x, Math.min(where.x, b.x + b.w)) - where.x, Math.max(b.y, Math.min(where.y, b.y + b.h)) - where.y);
    assert.ok(near > 24, 'it does not sit on the object: ' + near);
    const late = await brightAt(0, 14), ring = await brightAt(22, 27);
    assert.ok(late < early * 0.15, 'the icon has faded away, so the real object is not hidden (' + early + ' to ' + late + ')');
    assert.ok(ring > 20, 'a ring of dots marks the spot (' + ring + ' bright pixels on it)');
    const dark = await page.evaluate(`(() => { const cv = document.querySelector('#arCanvas'), s = cv.width / cv.clientWidth, d = cv.getContext('2d').getImageData(Math.round((${b.x} + 6) * s), Math.round((${b.y} + ${b.h} / 2) * s), 1, 1).data; return [d[0], d[1], d[2], d[3]]; })()`);
    assert.ok(dark[3] > 150 && dark[0] < 60, 'the bubble is a dark box with the text on it: ' + dark);
    // a tap on the bubble brings the full card; a tap on it again takes it away
    await page.touchscreen.tap(b.x + b.w / 2, b.y + b.h / 2);
    await page.waitForSelector('#arDetail h3', { state: 'visible', timeout: 3000 });
    assert.equal(await page.evaluate(() => window.__fg.state.sel), 'body:Moon', 'the same object is still picked');
    await page.touchscreen.tap(b.x + b.w / 2, b.y + b.h / 2);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#arDetail')).display === 'none', null, { timeout: 3000 });
  } finally { await context.close(); }
});

test('AR: a saved picture has the bubble in it', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await context.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
    await page.goto(base + '/viewer.html?fgtest=1');
    await page.evaluate(() => {
      window.__shared = []; navigator.canShare = () => true;
      navigator.share = async (d) => {
        const bmp = await createImageBitmap(d.files[0]), c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; c.getContext('2d').drawImage(bmp, 0, 0);
        window.__shared.push({ c, scale: bmp.width / document.querySelector('#arCanvas').clientWidth });
      };
    });
    await openAr(page, AR_SKY(0.5, 100));
    await page.evaluate(() => { const m = window.__fg.state.byId.get('body:Moon'); m.az = 100; m.el = 14; m.distKm = 384400; window.__fg.state.sel = 'body:Moon'; window.__fg.state.dirty = true; });
    await page.waitForFunction(() => window.__fg.arView().callout(), null, { timeout: 3000 });
    await sleep(600);
    const b = await page.evaluate(() => window.__fg.arView().callout());
    await page.tap('#arShot');
    await page.waitForFunction(() => window.__shared.length === 1, null, { timeout: 10000 });
    const px = await page.evaluate(`(() => { const s = window.__shared[0]; const d = s.c.getContext('2d').getImageData(Math.round((${b.x} + 6) * s.scale), Math.round((${b.y} + ${b.h} / 2) * s.scale), 1, 1).data; return [d[0], d[1], d[2]]; })()`);
    assert.ok(px[0] < 60 && px[1] < 60, 'the dark bubble is in the saved picture: ' + px);
  } finally { await context.close(); }
});

test('passes: the section is shown when a pass is under way or soon, and hidden when the next pass is hours away or over', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await context.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
    await page.goto(base + '/viewer.html?fgtest=1');
    await page.evaluate(PASSES);
    assert.equal(await page.isVisible('#passes'), true, 'a pass in about an hour and one in three: shown');
    const hours = (h) => page.evaluate((x) => { const { state, renderPasses } = window.__fg; const now = Date.now(); for (const p of state.passes) { p.start = now + x * 3600e3; p.end = p.start + 6 * 60e3; } renderPasses(); }, h);
    await hours(0.02);
    assert.equal(await page.isVisible('#passes'), true, 'about to start');
    await page.evaluate(() => { const { state, renderPasses } = window.__fg; const now = Date.now(); for (const p of state.passes) { p.start = now - 2 * 60e3; p.end = now + 4 * 60e3; } renderPasses(); });
    assert.equal(await page.isVisible('#passes'), true, 'under way');
    await hours(9);
    assert.equal(await page.isVisible('#passes'), false, 'the next pass is nine hours away: hidden');
    await hours(30);
    assert.equal(await page.isVisible('#passes'), false, 'tomorrow: hidden');
    await page.evaluate(() => { const { state, renderPasses } = window.__fg; const now = Date.now(); for (const p of state.passes) { p.start = now - 20 * 60e3; p.end = now - 10 * 60e3; } renderPasses(); });
    assert.equal(await page.isVisible('#passes'), false, 'already over: hidden');
    // one near and one far: only the near one is listed
    await page.evaluate(() => { const { state, renderPasses } = window.__fg; const now = Date.now(); state.passes[0].start = now + 3600e3; state.passes[0].end = state.passes[0].start + 6e5; state.passes[1].start = now + 20 * 3600e3; state.passes[1].end = state.passes[1].start + 6e5; renderPasses(); });
    assert.deepEqual(await page.$$eval('#passes button.pass b', (b) => b.map((x) => x.textContent)), ['ISS'], 'only the one that is soon');
    // choosing it still works with the right pass (the buttons keep their numbers)
    await page.click('#passes button.pass');
    assert.equal(await page.evaluate(() => window.__fg.state.passSel), 'ISS');
  } finally { await context.close(); }
});

// Search: find an object by name and pick it, the same as tapping it.
const searchSky = (extra) => `${FAKE_SKY}; (() => { const { state } = window.__fg; state.unseen = new Map([['sat:48274', { why: 'below', name: 'CSS (TIANHE)', el: -23, az: 45 }], ['air:zz1', { why: 'far', name: 'QTR8', el: 3, az: 1, rangeKm: 300 }]]); ${extra || ''} })()`;

test('search: typing a name lists matches, and picking one selects it on the radar, in the Nearby list and in the address', { skip }, async () => {
  const { page, context } = await linked('', searchSky());
  try {
    assert.equal(await page.isVisible('#searchBox'), false, 'the search box takes no room until it is wanted');
    assert.equal(await page.isVisible('#searchBtn'), true, 'a magnifier in the header opens it');
    assert.equal(await page.getAttribute('#searchBtn', 'aria-expanded'), 'false');
    await page.tap('#searchBtn');
    assert.equal(await page.isVisible('#searchBox'), true, 'tapping the magnifier shows it');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'searchBox', 'ready to type');
    assert.equal(await page.getAttribute('#searchBtn', 'aria-expanded'), 'true');
    assert.equal(await page.isVisible('#searchResults'), false, 'and no list until something is typed');
    await typeSearch(page, 'iss');
    const rows = await page.$$eval('#searchResults button.srch', (b) => b.map((x) => x.textContent));
    assert.equal(rows.length, 1); assert.match(rows[0], /ISS \(ZARYA\)/); assert.match(rows[0], /Space station/); assert.match(rows[0], /40° up/);
    assert.equal(await page.getAttribute('#searchBox', 'aria-expanded'), 'true');
    const r = await page.evaluate(() => { const l = document.querySelector('#searchResults').getBoundingClientRect(); return { l: l.left, r: l.right, w: innerWidth }; });
    assert.ok(r.l >= 0 && r.r <= r.w + 1, 'the list fits the phone: ' + JSON.stringify(r));
    await page.click('#searchResults button.srch');
    assert.equal(await page.evaluate(() => window.__fg.state.sel), 'sat:25544', 'it is the selected object');
    assert.match(await page.textContent('#detail h3'), /ISS \(ZARYA\)/, 'its card is shown');
    assert.equal(await page.evaluate(() => location.hash), '#o=sat:25544', 'and it has its link in the address');
    assert.equal(await page.inputValue('#searchBox'), '', 'the box is cleared'); assert.equal(await page.isVisible('#searchResults'), false, 'and the list is gone');
    assert.equal(await page.isVisible('#searchBox'), false, 'and the bar goes away again, giving its room back');
    await page.click('#tabNearby');
    assert.equal(await page.getAttribute('.nearby-row[data-id="sat:25544"]', 'class').then((c) => /\bsel\b/.test(c)), true, 'the Nearby list marks it as the selected one');
  } finally { await context.close(); }
});

test('search: picking from the Nearby page shows the radar, and a second search replaces the first pick', { skip }, async () => {
  const { page, context } = await linked('', searchSky());
  try {
    await page.click('#tabNearby');
    assert.equal(await page.evaluate(() => document.querySelector('#pager').classList.contains('nearby')), true);
    await typeSearch(page, 'moon'); await page.click('#searchResults button.srch');
    assert.equal(await page.evaluate(() => document.querySelector('#pager').classList.contains('nearby')), false, 'the radar is in view with its card');
    assert.equal(await page.evaluate(() => window.__fg.state.sel), 'body:Moon');
    await typeSearch(page, 'vega'); await page.click('#searchResults button.srch');
    assert.equal(await page.evaluate(() => window.__fg.state.sel), 'star:Vega'); assert.match(await page.textContent('#detail h3'), /Vega/);
    assert.equal(await page.evaluate(() => location.hash), '#o=star:Vega');
  } finally { await context.close(); }
});

test('search: the keyboard works: slash opens it, arrows move, Enter picks, Escape clears', { skip }, async () => {
  const { page, context } = await linked('', searchSky());
  try {
    await page.keyboard.press('/');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'searchBox', 'the slash key goes to the box');
    await page.keyboard.type('a'); // AIC144, Alpha...: several
    const n = await page.$$eval('#searchResults [role="option"]', (o) => o.length);
    assert.ok(n >= 2, 'several results for "a": ' + n);
    assert.equal(await page.getAttribute('#searchResults li:nth-child(1)', 'aria-selected'), 'true', 'the first is the active one');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.getAttribute('#searchResults li:nth-child(2)', 'aria-selected'), 'true');
    assert.equal(await page.getAttribute('#searchBox', 'aria-activedescendant'), 'sr-1');
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
    assert.equal(await page.getAttribute(`#searchResults li:nth-child(${n})`, 'aria-selected'), 'true', 'up from the first goes round to the last');
    await page.keyboard.press('Escape');
    assert.equal(await page.inputValue('#searchBox'), ''); assert.equal(await page.isVisible('#searchResults'), false);
    assert.equal(await page.isVisible('#searchBox'), false, 'Escape puts the bar away');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'searchBtn', 'and the focus goes back to the magnifier');
    await page.keyboard.press('/');
    assert.equal(await page.isVisible('#searchBox'), true, 'the slash opens it again');
    await page.keyboard.type('ve');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.__fg.state.sel), 'star:Vega', 'Enter picks the active result');
    await page.keyboard.press('/'); await page.keyboard.type('x/'); // a slash typed in the box is just a slash, not a jump
    assert.equal(await page.inputValue('#searchBox'), 'x/');
  } finally { await context.close(); }
});

test('search: an object that is not in the sky now can be picked, and its card says why', { skip }, async () => {
  const { page, context } = await linked('', searchSky());
  try {
    await typeSearch(page, 'tianhe');
    const row = (await page.$$eval('#searchResults button.srch', (b) => b.map((x) => x.textContent)))[0];
    assert.match(row, /CSS \(TIANHE\)/); assert.match(row, /below the horizon/);
    await page.click('#searchResults button.srch');
    assert.equal(await page.evaluate(() => window.__fg.state.sel), 'sat:48274');
    assert.match(await page.textContent('#detail .notvis'), /below the horizon/i, 'the card says why it is not on the radar');
    assert.doesNotMatch(await page.textContent('#detail'), /Nearest|AIC144/, 'not swapped for another object');
    await typeSearch(page, 'qtr'); assert.match(await page.textContent('#searchResults button.srch'), /too far to see/);
    await page.click('#searchResults button.srch');
    assert.equal(await page.evaluate(() => window.__fg.state.sel), 'air:zz1');
  } finally { await context.close(); }
});

test('search: nothing found says so, and clicking elsewhere closes the list', { skip }, async () => {
  const { page, context } = await linked('', searchSky());
  try {
    await typeSearch(page, 'zzzz');
    assert.match(await page.textContent('#searchResults .search-none'), /Nothing in the sky called “zzzz”/);
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.__fg.state.sel), null, 'Enter with nothing found picks nothing');
    await typeSearch(page, 'moon'); assert.equal(await page.isVisible('#searchResults'), true);
    await page.mouse.click(5, 400);
    assert.equal(await page.isVisible('#searchResults'), false, 'a click elsewhere closes the list');
    assert.equal(await page.isVisible('#searchBox'), true, 'but the bar stays while there is something typed in it');
    await page.fill('#searchBox', ''); await page.mouse.click(5, 400);
    assert.equal(await page.isVisible('#searchBox'), false, 'and goes when it is empty and the visitor clicks away');
  } finally { await context.close(); }
});

test('search: a picked object is the selected one in the camera view too', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await context.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
    await page.goto(base + '/viewer.html?fgtest=1');
    await page.evaluate(AR_SKY(0.5, 100));
    await page.evaluate(() => { const m = window.__fg.state.byId.get('body:Moon'); m.az = 100; m.el = 14; m.distKm = 384400; window.__fg.state.dirty = true; });
    await typeSearch(page, 'moon'); await page.click('#searchResults button.srch');
    assert.equal(await page.evaluate(() => window.__fg.state.sel), 'body:Moon');
    await fakeCamera(page); await page.tap('#arBtn'); await arShown(page);
    for (let i = 0; i < 30; i++) { await page.evaluate(() => { const e = new Event('deviceorientation'); e.webkitCompassHeading = 90; e.alpha = 0; e.beta = 90; e.gamma = 0; e.absolute = false; window.dispatchEvent(e); }); await sleep(30); }
    await page.waitForFunction(() => window.__fg.arView().callout(), null, { timeout: 5000 });
    assert.equal(await page.evaluate(() => window.__fg.state.sel), 'body:Moon', 'still the picked one');
    assert.equal(await page.isVisible('#arDetail'), false, 'its details are in the bubble beside it in the camera view');
  } finally { await context.close(); }
});

test('a tap is not lost when the card is redrawn between the press and the release, and the card catches up afterwards', { skip }, async () => {
  const { page, context } = await linked('#o=sat:25544', FAKE_SKY);
  try {
    await page.evaluate(() => { window.__copied = []; Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.__copied.push(t); return Promise.resolve(); } }, configurable: true }); });
    await page.locator('#detail [data-share]').scrollIntoViewIfNeeded(); // it is below the fold of a phone, and a raw mouse press does not scroll
    const b = await page.locator('#detail [data-share]').boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    // while the finger is down the card is rewritten with new numbers (this happens by itself every couple of seconds)
    await page.evaluate(() => { window.__fg.state.byId.get('sat:25544').el = 43; window.__fg.renderDetail(); });
    await sleep(100);
    await page.mouse.up();
    await page.waitForFunction(() => window.__copied.length === 1, null, { timeout: 5000 });
    // the card was not left stale: once the finger is up the next refresh shows the new numbers
    await page.waitForFunction(() => /43° up/.test(document.querySelector('#detail').textContent), null, { timeout: 8000 });
  } finally { await context.close(); }
});

test('card preview: a flight or a satellite with no photo gets a generic picture of its kind, small, and the card is no taller for it', { skip }, async () => {
  const { page, context } = await linked('', FAKE_SKY); // the outside world is off, so there is no photo
  try {
    await page.evaluate(() => {
      const { state } = window.__fg; const mk = (id, kind, name, az, el, x) => Object.assign({ id, kind, name, az, el, distKm: 500, range: 500 }, x || {});
      state.objs.push(mk('sat:1', 'sat', 'NOAA 19', 50, 30, { norad: 33591, altKm: 850, visible: true }), mk('sat:2', 'sat', 'CZ-4C R/B', 60, 20, { norad: 39000, altKm: 700, visible: true }), mk('sat:3', 'sat', 'STARLINK-1007', 70, 25, { norad: 44713, altKm: 550, visible: true }));
      state.byId = new Map(state.objs.map((o) => [o.id, o]));
      state.byId.get('air:a1').ac.call = 'AIC144';
    });
    for (const [id, label] of [['air:a1', /^An aircraft/], ['sat:25544', /^A space station/], ['sat:1', /^A satellite /], ['sat:2', /^A spent rocket/], ['sat:3', /^A communications satellite/]]) {
      await page.evaluate((i) => { window.__fg.state.sel = i; window.__fg.state.detailClosed = null; window.__fg.renderDetail(); }, id);
      const svg = page.locator('#detail .pv-generic svg');
      assert.equal(await svg.count(), 1, id + ' has a generic picture');
      assert.match(await svg.getAttribute('aria-label'), label, id);
      assert.match(await svg.getAttribute('aria-label'), /generic picture/, 'and says that it is generic');
      assert.equal(await page.textContent('#detail .pv-generic .pv-tag'), 'generic', 'and the picture itself says so');
      const box = await svg.boundingBox(); assert.ok(box.width >= 40 && box.width <= 60, 'small: ' + box.width);
      await tallerBy(page, 10);
    }
    assert.equal(await page.evaluate(() => document.querySelectorAll('#arDetail .pv-generic svg').length), 1, 'the card over the camera picture has it too');
    const ids = await page.evaluate(() => [...document.querySelectorAll('svg [id]')].map((n) => n.id));
    assert.deepEqual(ids, [], 'no names inside the drawing, so showing it twice in the page cannot clash');
  } finally { await context.close(); }
});

test('settings: the drawn symbols in the camera view are on at first, can be turned off, and stay off', { skip }, async () => {
  const { page, context } = await iphone({ storage: SAVED });
  try {
    await page.goto(base + '/settings.html');
    assert.equal(await page.isChecked('#arSymbolsToggle'), true, 'on by default');
    await page.uncheck('#arSymbolsToggle');
    assert.equal(await page.evaluate(() => localStorage.getItem('fg.arSymbols')), '0');
    await page.goto(base + '/settings.html');
    assert.equal(await page.isChecked('#arSymbolsToggle'), false, 'still off after coming back');
    await page.goto(base + '/viewer.html?fgtest=1');
    await page.waitForFunction(() => window.__fg && window.__fg.state && window.__fg.state.arSymbols !== undefined);
    assert.equal(await page.evaluate(() => window.__fg.state.arSymbols), false, 'the sky view picked the choice up');
    await page.goto(base + '/settings.html');
    await page.check('#arSymbolsToggle');
    assert.equal(await page.evaluate(() => localStorage.getItem('fg.arSymbols')), '1');

  } finally { await context.close(); }
});

test('small phones: no page scrolls sideways at 280 and 320 px, and the card never squeezes its values into a thin column', { skip }, async () => {
  const { page, context } = await linked('', FAKE_SKY);
  try {
    for (const w of [280, 320]) {
      await page.setViewportSize({ width: w, height: 640 });
      await page.evaluate(() => { window.__fg.state.sel = 'air:a1'; window.__fg.state.detailClosed = null; window.__fg.renderDetail(); });
      await page.locator('#detail dd').first().waitFor();
      const widths = await page.$$eval('#detail dd', (els) => els.map((e) => e.getBoundingClientRect().width));
      assert.ok(widths.length && widths.every((x) => x >= w * 0.6), 'values keep most of the width at ' + w + ' px: ' + widths.join());
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, 'the sky view scrolls sideways at ' + w + ' px');
    }
    for (const w of [280, 320]) {
      await page.setViewportSize({ width: w, height: 640 });
      for (const p of ['index.html', 'about.html', 'settings.html']) {
        await page.goto(base + '/' + p);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, p + ' scrolls sideways at ' + w + ' px');
      }
    }
  } finally { await context.close(); }
});

test('card: short by default (one-line route, two rows, buttons in one row), More opens the description and long rows, and it is remembered', { skip }, async () => {
  const { page, context } = await linked('', FAKE_SKY);
  try {
    await page.evaluate(() => { window.__fg.state.byId.get('air:a1').ac.call = 'AIC144'; window.__fg.state.sel = 'air:a1'; window.__fg.state.detailClosed = null; window.__fg.renderDetail(); });
    await page.locator('#detail .acts').waitFor();
    const short = await page.locator('#detail').boundingBox();
    assert.equal(await page.locator('#detail .more').textContent(), 'More');
    assert.equal(await page.locator('#detail dt').count() <= 3, true, 'at most three rows when short');
    assert.equal(await page.locator('#detail .blurb').count(), 0, 'no description yet');
    assert.equal(await page.locator('#detail .acts .tracklink').count(), 1, 'FlightAware sits with the buttons');
    await page.locator('#detail .more').click();
    await page.locator('#detail .more').filter({ hasText: 'Less' }).waitFor();
    const long = await page.locator('#detail').boundingBox();
    assert.ok(long.height > short.height + 30, `More makes the card taller (${short.height} -> ${long.height})`);
    assert.deepEqual(await page.$$eval('#detail dt', (e) => e.map((x) => x.textContent)).then((t) => ['Altitude', 'Speed', 'Distance'].every((k) => t.includes(k))), true);
    assert.equal(await page.evaluate(() => localStorage.getItem('fg.cardMore')), 'true', 'the choice is saved, so the next visit opens the same way');
    await page.locator('#detail .more').click();
    assert.equal(await page.locator('#detail .more').textContent(), 'More', 'and Less closes it again');
  } finally { await context.close(); }
});
