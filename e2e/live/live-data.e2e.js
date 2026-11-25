'use strict';
// Live-data check: does the real data the app depends on look right at several places in the world?
// It talks to the real feeds, so it is not part of `npm test` (feeds change by the minute and rate-limit).
//   npm run test:live
// Set AIRCRAFT_PROXY_URL (the same Worker address the site is built with) to include the aircraft checks.
// It runs daily and on demand in GitHub Actions (.github/workflows/live-data.yml).
//
// What it checks, for Seattle, New York, London, Hyderabad and Sydney:
//   aircraft   the proxy answers with real aircraft near the place, with sane positions, heights and speeds
//   sun        sunrise and sunset from the app's astronomy library against an independent service
//   moon       the Moon's lit fraction against a simple textbook formula
//   weather    Open-Meteo gives a believable temperature and cloud cover, from now
//   satellites CelesTrak gives fresh ISS elements, and the app's library puts the ISS at a believable height and speed
// A feed that is down (HTTP 5xx or a timeout) skips its check with the reason, instead of failing the run.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const L = require('../../lib/logic.js');

const PLACES = [
  { name: 'Seattle', lat: 47.6, lon: -122.3, busy: false },
  { name: 'New York', lat: 40.7, lon: -74.0, busy: true },
  { name: 'London', lat: 51.5, lon: -0.1, busy: true },
  { name: 'Hyderabad', lat: 17.4, lon: 78.5, busy: false },
  { name: 'Sydney', lat: -33.9, lon: 151.2, busy: false },
];
const PROXY = process.env.AIRCRAFT_PROXY_URL || '';
const ORIGIN = 'http://localhost:8080'; // local origins are always allowed by the proxy, so no site address is needed here
const ASTRONOMY_URL = 'https://cdn.jsdelivr.net/npm/astronomy-engine@2.1.19/astronomy.browser.min.js';
const SATELLITE_URL = 'https://cdn.jsdelivr.net/npm/satellite.js@5.0.0/dist/satellite.min.js';
const DAY = 864e5;

async function get(url, opts = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000), ...opts });
  return res;
}
// The feed is "down" when it cannot be reached or answers with a server error: skip, do not fail.
async function getOrSkip(t, url, opts) {
  let res;
  try { res = await get(url, opts); } catch (e) { t.skip(`${new URL(url).host} unreachable (${e.name})`); return null; }
  if (res.status >= 500 || res.status === 429) { t.skip(`${new URL(url).host} answered HTTP ${res.status}`); return null; }
  return res;
}

// The two browser libraries, loaded the same way the page loads them, into an isolated context.
const libs = {};
async function lib(name, url) {
  if (!libs[name]) {
    const src = await (await get(url)).text();
    const sandbox = { console }; sandbox.self = sandbox; sandbox.window = sandbox; sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox);
    sandbox.Date_ = vm.runInContext('Date', sandbox); // the context's own Date
    libs[name] = sandbox;
  }
  return libs[name];
}
const astronomy = async () => (await lib('astronomy', ASTRONOMY_URL)).Astronomy;
const satellite = async () => (await lib('satellite', SATELLITE_URL)).satellite;
// The library checks `instanceof Date`, and it lives in its own context, so give it that context's own Date.
const libDate = async (ms) => new (await lib('astronomy', ASTRONOMY_URL)).Date_(ms);

for (const p of PLACES) {
  test(`aircraft near ${p.name} are real and sensible`, { skip: PROXY ? false : 'AIRCRAFT_PROXY_URL is not set' }, async (t) => {
    // The proxy is ours: when it cannot get aircraft from ANY provider it answers 502, and that is a failure to look at,
    // not a feed to skip. Only a deliberate switch-off (503 with disabled: true) is skipped.
    let res;
    try { res = await get(L.aircraftProxyUrl(PROXY, p.lat, p.lon, 150), { headers: { Origin: ORIGIN } }); } catch (e) { assert.fail('the proxy did not answer: ' + e.name); }
    if (res.status === 503 && (await res.clone().json().catch(() => ({}))).disabled) return t.skip('the proxy is switched off');
    assert.equal(res.status, 200, `proxy answered HTTP ${res.status}: ${res.status >= 500 ? JSON.stringify(await res.clone().json().catch(() => ({}))) : ''}`);
    const list = L.parseV2(await res.json());
    if (p.busy) assert.ok(list.length >= 5, `${p.name} should be busy, got ${list.length}`);
    const ids = new Set();
    for (const a of list) {
      assert.ok(!ids.has(a.id), `aircraft ${a.id} listed twice`); ids.add(a.id);
      assert.ok(Number.isFinite(a.lat) && Math.abs(a.lat) <= 90 && Number.isFinite(a.lon) && Math.abs(a.lon) <= 180, `${a.id} has a position`);
      const km = L.distanceKm(p.lat, p.lon, a.lat, a.lon);
      assert.ok(km < 340, `${a.id} is ${Math.round(km)} km from ${p.name}, outside the 150 nm query`);
      assert.ok(a.altFt > 150 && a.altFt < 60000, `${a.id} height ${a.altFt} ft`);
      assert.ok(a.gs >= 0 && a.gs < 1300, `${a.id} speed ${a.gs} kt`);
      assert.ok(a.track >= 0 && a.track <= 360, `${a.id} track ${a.track}`);
    }
    const shown = list.filter((a) => L.distanceKm(p.lat, p.lon, a.lat, a.lon) <= L.DEFAULT_FLIGHT_RANGE_KM);
    t.diagnostic(`${p.name}: ${list.length} aircraft in the query, ${shown.length} within the default ${L.DEFAULT_FLIGHT_RANGE_KM} km (feed: ${res.headers.get('x-provider') || 'cached answer'})`);
  });
}

for (const p of PLACES) {
  test(`sunrise and sunset in ${p.name} agree with an independent service`, async (t) => {
    const Astronomy = await astronomy();
    const obs = new Astronomy.Observer(p.lat, p.lon, 0);
    const day = new Date().toISOString().slice(0, 10);
    const res = await getOrSkip(t, `https://api.sunrise-sunset.org/json?lat=${p.lat}&lng=${p.lon}&date=${day}&formatted=0`);
    if (!res) return;
    const j = await res.json();
    if (j.status !== 'OK') return t.skip(`sunrise-sunset.org said ${j.status}`);
    for (const [key, dir] of [['sunrise', +1], ['sunset', -1]]) {
      const theirs = new Date(j.results[key]);
      const ours = Astronomy.SearchRiseSet(Astronomy.Body.Sun, obs, dir, await libDate(theirs.getTime() - 12 * 3600e3), 2).date;
      const minutes = Math.abs(ours - theirs) / 60e3;
      assert.ok(minutes <= 4, `${p.name} ${key}: app maths ${ours.toISOString()} vs service ${theirs.toISOString()} (${minutes.toFixed(1)} min apart)`);
    }
  });
}

test('the Moon\'s lit fraction agrees with the textbook mean-phase formula', async () => {
  const Astronomy = await astronomy();
  const now = new Date(), libNow = await libDate(now.getTime());
  const lit = Astronomy.Illumination(Astronomy.Body.Moon, libNow).phase_fraction;
  const SYNODIC = 29.530588853, NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);
  const age = (((now - NEW_MOON) / DAY) % SYNODIC + SYNODIC) % SYNODIC;
  const expected = (1 - Math.cos(2 * Math.PI * age / SYNODIC)) / 2;
  assert.ok(Math.abs(lit - expected) < 0.08, `app maths ${lit.toFixed(3)} vs mean phase ${expected.toFixed(3)} (Moon age ${age.toFixed(1)} days)`);
  assert.ok(Number.isFinite(Astronomy.MoonPhase(libNow)));
});

for (const p of PLACES) {
  test(`weather for ${p.name} is believable and current`, async (t) => {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${p.lat.toFixed(2)}&longitude=${p.lon.toFixed(2)}&current=cloud_cover,temperature_2m`;
    const res = await getOrSkip(t, url);
    if (!res) return;
    assert.equal(res.status, 200);
    const c = (await res.json()).current;
    assert.ok(c.cloud_cover >= 0 && c.cloud_cover <= 100, `cloud ${c.cloud_cover}`);
    assert.ok(c.temperature_2m > -60 && c.temperature_2m < 55, `temperature ${c.temperature_2m}`);
    const ageH = Math.abs(Date.now() - new Date(c.time + 'Z').getTime()) / 3600e3;
    assert.ok(ageH < 4, `reading is ${ageH.toFixed(1)} hours from now`);
  });
}

test('satellite elements are fresh, and the ISS is at a believable height and speed', async (t) => {
  // Through the proxy (which has fallbacks for when CelesTrak is down) when there is one, else straight from CelesTrak.
  const sources = [L.tleProxyUrl(PROXY, 'stations'), 'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle'].filter(Boolean);
  let text = '', via = '';
  for (const url of sources) {
    try {
      const res = await get(url, { headers: { Origin: ORIGIN } });
      const body = res.ok ? await res.text() : '';
      if (/^1 \d{5}/m.test(body)) { text = body; via = new URL(url).host + (res.headers.get('x-provider') ? ' (' + res.headers.get('x-provider') + ')' : ''); break; }
    } catch { /* try the next source */ }
  }
  if (!text) return t.skip('no source of element sets answered (the proxy and CelesTrak are both unavailable)');
  t.diagnostic('element sets from ' + via);
  const sat = await satellite();
  const sats = L.parseTLE(text, 'stations', (l1, l2) => sat.twoline2satrec(l1, l2));
  assert.ok(sats.length >= 3, `parsed ${sats.length} space stations`);
  const iss = sats.find((s) => /ISS|ZARYA/i.test(s.name));
  assert.ok(iss, 'the ISS is in the feed');
  const rec = iss.rec, year = rec.epochyr < 57 ? 2000 + rec.epochyr : 1900 + rec.epochyr;
  const epoch = Date.UTC(year, 0, 1) + (rec.epochdays - 1) * DAY;
  assert.ok((Date.now() - epoch) / DAY < 14, `ISS elements are ${((Date.now() - epoch) / DAY).toFixed(1)} days old`);
  const now = new Date(), pv = sat.propagate(rec, now);
  assert.ok(pv.position, 'propagates to now');
  const heightKm = sat.eciToGeodetic(pv.position, sat.gstime(now)).height;
  const speed = Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z);
  assert.ok(heightKm > 350 && heightKm < 480, `ISS height ${heightKm.toFixed(0)} km`);
  assert.ok(speed > 7.3 && speed < 7.9, `ISS speed ${speed.toFixed(2)} km/s`);
});
