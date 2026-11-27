'use strict';
// The reusable building blocks of the browser tests. READ docs/TESTING.md BEFORE WRITING A NEW BROWSER TEST, and use these instead of
// writing your own: each of them is here because the first version written inline failed at random in CI (a fake camera that did not
// stick, a position worked out before the picture had settled, a click before the page was ready...). A new test that starts from
// these inherits what was learned; one that reaches for the browser directly will probably learn it all again.
//
//   iphone({ storage, answer, quiet, device, desktopUA })   a fresh iPhone (or iPad) page with the motion permission and a camera of its own
//   linked(hash, setup, before)                             opens viewer.html?fgtest=1 with the sky libraries blocked and a sky set up
//   openAr(page, sky, { still })                            opens the camera view facing east, with the camera and compass settled
//   arShown(page)                                           waits for the camera view; when it does not show, says what the page was doing
//   fakeCamera(page)                                        puts a camera of its own on the page (called for you by openAr)
//   heading(page, magnetic, times, beta)                    feeds compass readings
//   wikiAnswers(context, { thumb, picture })                answers Wikipedia and its picture server
//   openSearch(page) / typeSearch(page, text)               opens the search bar (it is hidden until wanted) and types in it
//   tallerBy(page, most)                                    checks the picture on the card adds no more than `most` px of height
// And the static pieces: HITEC, SAVED (a stored location), FAKE_SKY, AR_SKY, PNG, sleep.
const assert = require('node:assert/strict');

const HITEC = { latitude: 17.4435, longitude: 78.3772 }; // HITEC City, Hyderabad
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// What Safari on iPadOS 13 and later sends: it says it is a Mac, and the touch screen is the only hint.
const DESKTOP_SAFARI_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';


const SAVED = { 'fg.loc': JSON.stringify({ lat: HITEC.latitude, lon: HITEC.longitude }) };

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


// A sky for the camera view: the Moon right ahead (facing 90°, level), with the Sun to one side of it.
const AR_SKY = (phase, sunAz) => `(() => {
  const { state } = window.__fg;
  state.declination = 0; state.ori.declination = 0; state.arOffset = { h: 0, p: 0 };
  const mk = (id, kind, name, az, el, extra) => Object.assign({ id, kind, name, az, el, distKm: 1, range: 1 }, extra || {});
  state.objs = [mk('body:Moon', 'body', 'Moon', 90, 0, { phase: ${phase}, color: '#e6ecf5' }), mk('body:Sun', 'body', 'Sun', ${sunAz}, 0, { phase: null, color: '#ffd86b' })];
  state.byId = new Map(state.objs.map((o) => [o.id, o]));
  state.sel = null; state.dirty = true;
})()`;


const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

// Pass what the test file owns: playwright, and functions that give the browser and the base address (they are set when the run starts).
function createHelpers({ playwright, getBrowser, getBase }) {
  // A fresh iPhone page. `answer` is what the iPhone motion prompt will say when the visitor is asked.
  // `quiet`: the browser already allows location for the site (so the page can fetch it without asking). By default the
  // browser reports "ask", like a first visit, even though the test browser will answer when asked.
  async function iphone({ storage = {}, answer = 'granted', quiet = false, device = 'iPhone 14', desktopUA = false } = {}) {
    const context = await getBrowser().newContext({
      ...playwright.devices[device], ...(desktopUA ? { userAgent: DESKTOP_SAFARI_UA } : {}), serviceWorkers: 'block',
      geolocation: HITEC, permissions: ['geolocation'],
    });
    // The outside world is switched off: no request leaves for a host other than this machine and the CDN the sky libraries come from.
    // (A page that really asked Wikipedia, the weather or the flight feeds was changed by the answers at random moments, which moved
    // buttons under a click and failed tests one run in twenty.) A test that wants an answer from one of them registers its own route
    // after this; the last route registered is the first one asked. See rule 11 in docs/TESTING.md.
    await context.route((url) => !/^(localhost|127\.0\.0\.1|cdn\.jsdelivr\.net)$/.test(url.hostname) && /^https?:$/.test(url.protocol), (r) => r.abort());
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
      // The browser's own object is not touched (on some builds a plain assignment to it does not stick, and the page then asks for a real
      // camera and is refused, which failed the AR tests at random): the page gets one of ours.
      Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: async () => fake }, configurable: true, writable: true });
      Object.defineProperty(HTMLVideoElement.prototype, 'srcObject', { configurable: true, get() { return this.__src || null; }, set(v) { this.__src = v; } });
      HTMLVideoElement.prototype.play = () => Promise.resolve();
      // Every message the app shows in its toast, in order, so a message that is soon replaced can still be checked.
      window.__toasts = [];
      // Every click and its target, and every error, with the time, for the failure message when a step times out.
      window.__diagClicks = []; window.__diagErrs = [];
      document.addEventListener('click', (e) => window.__diagClicks.push([(e.target && (e.target.id || e.target.tagName)) + '', Math.round(performance.now())]), true);
      window.addEventListener('error', (e) => window.__diagErrs.push(String(e.message).slice(0, 120)));
      window.addEventListener('unhandledrejection', (e) => window.__diagErrs.push('rejection: ' + String(e.reason).slice(0, 120)));
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

  // A link to one object (viewer.html#o=<id>): the sky libraries are blocked so the test sets up the objects itself.
  const linked = async (hash, setup, before) => {
    const r = await iphone({ storage: SAVED });
    await r.context.route('https://cdn.jsdelivr.net/**', (x) => x.abort());
    if (before) await before(r.context); // answers to set up before the page asks
    await r.page.goto(getBase() + '/viewer.html?fgtest=1' + hash);
    if (setup) await r.page.evaluate(setup);
    return r;
  };


  // The same camera, put on the page itself again just before the AR button is tapped, in case the page's own start-up replaced it.
  const fakeCamera = (page) => page.evaluate(() => { const fake = { getTracks: () => [{ stop() {} }] }; Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: async () => fake }, configurable: true, writable: true }); });

  // Waits for the camera view to show; when it does not, the failure says what the page was doing.
  async function arShown(page, timeout = 15000) {
    try { await page.waitForFunction(() => !document.querySelector('#ar').hidden, null, { timeout }); }
    catch (e) {
      const d = await page.evaluate(() => ({ hidden: document.querySelector('#ar').hidden, asked: window.__ios && window.__ios.asked.length, gum: String(navigator.mediaDevices && navigator.mediaDevices.getUserMedia).slice(0, 60), toasts: window.__toasts, clicks: window.__diagClicks, errs: window.__diagErrs, now: Math.round(performance.now()), arBtn: (() => { const b = document.querySelector('#arBtn'), r = b && b.getBoundingClientRect(); return r && [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height), b.disabled, !!b.onclick]; })(), compass: localStorage.getItem('fg.compass'), ready: document.readyState, libs: [typeof Astronomy, typeof satellite], body: document.body.className })).catch((err) => ({ evaluateFailed: String(err) }));
      throw new Error('the camera view did not show | page state: ' + JSON.stringify(d), { cause: e });
    }
  }

  // Opens the camera view, facing east with the phone upright, and lets the heading settle.
  // still: keep the crosshair from picking what it is held on (that would fade the picked icon while a test measures the picture).
  async function openAr(page, sky, { still = false } = {}) {
    await page.evaluate(sky);
    await fakeCamera(page);
    await page.tap('#arBtn');
    await arShown(page);
    if (still) await page.evaluate(() => window.__fg.arView().setAligning(true));
    for (let i = 0; i < 30; i++) {
      await page.evaluate(() => { const e = new Event('deviceorientation'); e.webkitCompassHeading = 90; e.alpha = 0; e.beta = 90; e.gamma = 0; e.absolute = false; window.dispatchEvent(e); });
      await sleep(30);
    }
    await sleep(300);
  }


  // How much taller the card is with its picture than without it.
  const tallerBy = async (page, most) => {
    const d = await page.evaluate(() => { const c = document.querySelector('#detail'), pv = c.querySelector('.pv'), h1 = c.getBoundingClientRect().height; pv.style.display = 'none'; const h0 = c.getBoundingClientRect().height; pv.style.display = ''; return h1 - h0; });
    assert.ok(d <= most, 'the picture makes the card ' + d + ' px taller (at most ' + most + ')');
  };
  const wikiAnswers = async (context, { thumb = true, picture = 200 } = {}) => {
    await context.route('https://en.wikipedia.org/api/rest_v1/page/summary/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(Object.assign({ type: 'standard', extract: 'An aircraft type.' }, thumb ? { thumbnail: { source: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/x/xy/Airbus_A320neo.jpg/320px-Airbus_A320neo.jpg?utm_source=en.wikipedia.org', width: 320, height: 213 } } : {})) }));
    await context.route('https://thumb.wikimedia.org/**', (r) => (picture === 200 ? r.fulfill({ status: 200, contentType: 'image/png', body: PNG }) : r.abort()));
  };


  // The search bar takes no room until it is wanted: it opens from the magnifier in the header.
  const openSearch = async (page) => { if (!(await page.isVisible('#searchBox'))) await page.tap('#searchBtn'); await page.waitForSelector('#searchBox', { state: 'visible' }); };
  const typeSearch = async (page, text) => { await openSearch(page); await page.fill('#searchBox', text); };

  return { iphone, heading, linked, fakeCamera, arShown, openAr, tallerBy, wikiAnswers, openSearch, typeSearch };
}

module.exports = { createHelpers, HITEC, sleep, DESKTOP_SAFARI_UA, SAVED, FAKE_SKY, AR_SKY, PNG };
