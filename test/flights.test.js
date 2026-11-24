'use strict';
// Flights you can see, the plane icon, and route lookup.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../lib/logic.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const W = import('../worker/aircraft-proxy.mjs');

test('horizonKm grows with height: a jet at 11 km can be 370+ km away along the ground', () => {
  assert.equal(L.horizonKm(0), 0);
  assert.ok(Math.abs(L.horizonKm(11) - 374.5) < 1);
  assert.ok(L.horizonKm(1) < L.horizonKm(10));
  assert.equal(L.horizonKm(-5), 0);
});

test('isVisibleFlight needs a clear angle above the horizon and a short distance', () => {
  assert.equal(L.isVisibleFlight(40, 15), true, 'nearly overhead');
  assert.equal(L.isVisibleFlight(2, 20), false, 'too low, hidden by buildings and haze');
  assert.equal(L.isVisibleFlight(30, 150), false, 'too far to see');
  assert.equal(L.isVisibleFlight(5, 60), true, 'at the limits');
  assert.equal(L.isVisibleFlight(NaN, 10), false);
  assert.equal(L.isVisibleFlight(20, 90, { maxRangeKm: 100 }), true, 'limits can be changed');
});

test('parseVisOnly is on unless switched off', () => {
  assert.equal(L.parseVisOnly(null), true);
  assert.equal(L.parseVisOnly('1'), true);
  assert.equal(L.parseVisOnly('0'), false);
});

test('the plane is a Unicode airplane in text style, turned to its direction of travel', () => {
  assert.equal(L.PLANE_GLYPH.codePointAt(0), 0x2708);
  assert.equal(L.PLANE_GLYPH.codePointAt(1), 0xfe0e, 'text variation selector avoids a colour emoji');
  // travelling up-right on screen needs no extra turn, because the glyph's nose points up-right
  assert.ok(Math.abs(L.planeRotation(-Math.PI / 4)) < 1e-9);
  assert.ok(Math.abs(L.planeRotation(0) - Math.PI / 4) < 1e-9);
});

test('app draws the plane glyph and filters flights by visibility', () => {
  const app = read('app.js');
  assert.match(app, /PLANE_GLYPH/);
  assert.match(app, /planeRotation/);
  assert.match(app, /isVisibleFlight/);
  assert.match(app, /state\.visOnly && !seen/);
  assert.doesNotMatch(app, /ctx\.moveTo\(6, 0\)/, 'the old arrow-head shape is gone');
});

test('settings offer the visible-only choice and store it', () => {
  assert.match(read('settings.html'), /id="visOnlyToggle"/);
  assert.match(read('settings.js'), /fg\.visOnly/);
});

test('routeProxyUrl builds the route URL next to the aircraft URL', () => {
  assert.equal(L.routeProxyUrl('https://w.example/aircraft', 'ual1', 17.4609, 78.3278), 'https://w.example/route?callsign=UAL1&lat=17.461&lon=78.328');
  assert.equal(L.routeProxyUrl('', 'UAL1', 1, 2), null, 'no proxy, no route lookup');
  assert.equal(L.routeProxyUrl('https://w.example/aircraft', '', 1, 2), null, 'no callsign');
  assert.equal(L.routeProxyUrl('https://w.example/other', 'UAL1', 1, 2), null, 'unknown URL shape');
});

test('describeAirport shows the code, name and city', () => {
  assert.equal(L.describeAirport({ iata: 'HYD', name: 'Rajiv Gandhi International', city: 'Hyderabad' }), 'HYD · Rajiv Gandhi International (Hyderabad)');
  assert.equal(L.describeAirport({ icao: 'VOHS', name: '' }), 'VOHS');
  assert.equal(L.describeAirport(null), null);
});

test('distanceKm and bearingTo agree with known geography', () => {
  assert.ok(Math.abs(L.distanceKm(0, 0, 0, 1) - 111.19) < 0.5);
  assert.ok(Math.abs(L.bearingTo(0, 0, 1, 0) - 0) < 1e-6);
  assert.ok(Math.abs(L.bearingTo(0, 0, 0, 1) - 90) < 1e-6);
});

const AP = (iata, name, city, lat, lon) => ({ iata_code: iata, icao_code: 'K' + iata, name, municipality: city, country_iso_name: 'IN', latitude: lat, longitude: lon });
const ADSBDB = (o, d) => ({ response: { flightroute: { callsign: 'AIC144', origin: o, destination: d } } });

test('normalizeRoute reads origin and destination from the adsbdb answer', async () => {
  const { normalizeRoute } = await W;
  const r = normalizeRoute(ADSBDB(AP('EWR', 'Newark Liberty', 'New York', 40.69, -74.17), AP('BOM', 'Chhatrapati Shivaji', 'Mumbai', 19.09, 72.87)), 'AIC144');
  assert.equal(r.origin.iata, 'EWR');
  assert.equal(r.destination.iata, 'BOM');
  assert.equal(r.destination.city, 'Mumbai');
  assert.equal(r.destination.lat, 19.09);
});

test('normalizeRoute gives nulls for unknown or malformed answers', async () => {
  const { normalizeRoute } = await W;
  for (const up of [null, {}, { response: 'unknown callsign' }, { response: { flightroute: null } }, ADSBDB(AP('A', 'A', 'A', 1, 1), null)]) {
    const r = normalizeRoute(up, 'X1');
    assert.equal(r.origin, null);
    assert.equal(r.destination, null);
  }
});

test('parseCallsign accepts plain callsigns only', async () => {
  const { parseCallsign } = await W;
  const u = (c) => new URL('https://x/route?callsign=' + encodeURIComponent(c));
  assert.equal(parseCallsign(u('ual123')), 'UAL123');
  assert.equal(parseCallsign(u('../etc')), null);
  assert.equal(parseCallsign(u('A')), null);
  assert.equal(parseCallsign(u('TOOLONGCALL1')), null);
  assert.equal(parseCallsign(new URL('https://x/route')), null);
});

function fakeCache() {
  const m = new Map();
  return {
    match: async (req) => (m.has(req.url) ? m.get(req.url).clone() : undefined),
    put: async (req, res) => { m.set(req.url, res.clone()); },
  };
}
const ENV = { ALLOWED_ORIGINS: 'https://fargems.example' };
const ROUTE = (q) => new Request('https://worker.example/route' + q, { headers: { Origin: 'https://fargems.example' } });
const UPSTREAM_OK = JSON.stringify(ADSBDB(AP('DEL', 'Delhi', 'Delhi', 28.5, 77.1), AP('HYD', 'Hyderabad', 'Hyderabad', 17.2, 78.4)));

test('worker /route returns the destination, caches it, and shares it between visitors', async () => {
  const { handle } = await W;
  const cache = fakeCache();
  let calls = 0, sent;
  const fetchImpl = async (url, init) => { calls++; sent = { url, init }; return new Response(UPSTREAM_OK, { status: 200 }); };
  const first = await handle(ROUTE('?callsign=aic144'), ENV, { fetchImpl, cache });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('Access-Control-Allow-Origin'), 'https://fargems.example');
  assert.equal(first.headers.get('X-Cache'), 'MISS');
  assert.equal((await first.json()).destination.iata, 'HYD');
  assert.equal(sent.url, 'https://api.adsbdb.com/v0/callsign/AIC144');
  assert.match(sent.init.headers['User-Agent'], /FarGems/);
  const second = await handle(ROUTE('?callsign=AIC144&lat=18&lon=79'), ENV, { fetchImpl, cache });
  assert.equal(second.headers.get('X-Cache'), 'HIT');
  assert.equal(calls, 1, 'the second visitor did not cost an upstream request');
});

test('worker /route validates the callsign and reports upstream failure', async () => {
  const { handle } = await W;
  const noFetch = async () => { throw new Error('must not be called'); };
  assert.equal((await handle(ROUTE('?callsign=%2E%2E'), ENV, { fetchImpl: noFetch, cache: fakeCache() })).status, 400);
  assert.equal((await handle(ROUTE(''), ENV, { fetchImpl: noFetch, cache: fakeCache() })).status, 400);
  const down = async () => new Response('', { status: 500 });
  assert.equal((await handle(ROUTE('?callsign=UAL1'), ENV, { fetchImpl: down, cache: fakeCache() })).status, 502);
});

test('worker /route remembers flights the database does not know, for a shorter time', async () => {
  const { handle } = await W;
  const fetchImpl = async () => new Response('{"response":"unknown callsign"}', { status: 404 });
  const res = await handle(ROUTE('?callsign=N123AB'), ENV, { fetchImpl, cache: fakeCache() });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).destination, null);
  assert.match(res.headers.get('Cache-Control'), /max-age=600/);
});

test('tapping a flight beats a star drawn behind it', () => {
  assert.match(read('app.js'), /startsWith\('star:'\)/);
});

test('isDisabled reads the ENABLED switch: off only for an explicit off value', async () => {
  const { isDisabled } = await W;
  for (const v of ['false', 'FALSE', '0', 'off', 'no', ' disabled ']) assert.equal(isDisabled({ ENABLED: v }), true, v);
  for (const v of ['true', '1', 'on', '']) assert.equal(isDisabled({ ENABLED: v }), false, v);
  assert.equal(isDisabled({}), false, 'unset means on');
  assert.equal(isDisabled(undefined), false);
});

test('a switched-off worker answers 503 at once for every path, without any upstream call or cache read', async () => {
  const { handle } = await W;
  const noFetch = async () => { throw new Error('must not be called'); };
  const cache = { match: async () => { throw new Error('cache must not be read'); }, put: async () => { throw new Error('no'); } };
  for (const p of ['/aircraft?lat=1&lon=1', '/route?callsign=UAL1', '/other']) {
    const res = await handle(new Request('https://worker.example' + p, { headers: { Origin: 'https://fargems.example' } }), { ...ENV, ENABLED: 'false' }, { fetchImpl: noFetch, cache });
    assert.equal(res.status, 503, p);
    assert.equal((await res.json()).disabled, true);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://fargems.example', 'the page can still read the answer');
    assert.ok(Number(res.headers.get('Retry-After')) > 0);
  }
});

test('the app tells the visitor when the proxy is switched off', () => {
  const app = read('app.js');
  assert.match(app, /HTTP 503/);
  assert.match(app, /feed switched off for now/);
});

test('routeEntryFresh retries failed and unknown lookups later, and keeps known routes', () => {
  const T = 1_000_000;
  assert.equal(L.routeEntryFresh(undefined, T), false, 'nothing remembered: look it up');
  assert.equal(L.routeEntryFresh({ state: 'loading', at: T - 5000 }, T), true, 'wait for the lookup in progress');
  assert.equal(L.routeEntryFresh({ state: 'failed', at: T - 10_000 }, T), true, 'a fresh failure is not hammered');
  assert.equal(L.routeEntryFresh({ state: 'failed', at: T - 61_000 }, T), false, 'a failure is retried after a minute');
  assert.equal(L.routeEntryFresh({ state: 'done', at: T - 61_000, data: { destination: null } }, T), true);
  assert.equal(L.routeEntryFresh({ state: 'done', at: T - 601_000, data: { destination: null } }, T), false, 'unknown is retried after ten minutes');
  assert.equal(L.routeEntryFresh({ state: 'done', at: T - 86_400_000, data: { destination: { iata: 'BOM' } } }, T), true, 'a known route is kept');
  assert.equal(L.routeEntryFresh({ state: 'weird', at: T }, T), false);
});

test('the app uses routeEntryFresh and stamps every route entry with a time', () => {
  const app = read('app.js');
  assert.match(app, /routeEntryFresh\(r, Date\.now\(\)\)/);
  assert.equal((app.match(/state\.routes\.set\([^)]*at: Date\.now\(\)/g) || []).length, 3);
});
