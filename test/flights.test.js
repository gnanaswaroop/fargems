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
  assert.equal(L.routeProxyUrl('https://w.example/aircraft', 'ual1', 17.4436, 78.3772), 'https://w.example/route?callsign=UAL1&lat=17.444&lon=78.377');
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

test('normalizeRoute takes the first airport as origin and the last as destination', async () => {
  const { normalizeRoute } = await W;
  const up = [{ callsign: 'AIC144', plausible: true, _airports: [
    { iata: 'DEL', icao: 'VIDP', name: 'Indira Gandhi International', location: 'Delhi', countryiso2: 'IN', lat: 28.56, lon: 77.1 },
    { iata: 'HYD', icao: 'VOHS', name: 'Rajiv Gandhi International', location: 'Hyderabad', countryiso2: 'IN', lat: 17.24, lon: 78.43 },
  ] }];
  const r = normalizeRoute(up, 'AIC144');
  assert.equal(r.origin.iata, 'DEL');
  assert.equal(r.destination.iata, 'HYD');
  assert.equal(r.destination.city, 'Hyderabad');
  assert.equal(r.destination.lat, 17.24);
});

test('normalizeRoute gives nulls for unknown, implausible or malformed routes', async () => {
  const { normalizeRoute } = await W;
  for (const up of [[], null, [{ _airports: [] }], [{ plausible: false, _airports: [{ iata: 'A' }, { iata: 'B' }] }], [{ _airports: [{ iata: 'A' }] }]]) {
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
const UPSTREAM_OK = JSON.stringify([{ plausible: true, _airports: [{ iata: 'DEL', name: 'Delhi' }, { iata: 'HYD', name: 'Hyderabad' }] }]);

test('worker /route returns the destination, caches it, and shares it between visitors', async () => {
  const { handle } = await W;
  const cache = fakeCache();
  let calls = 0, sent;
  const fetchImpl = async (url, init) => { calls++; sent = { url, init }; return new Response(UPSTREAM_OK, { status: 200 }); };
  const first = await handle(ROUTE('?callsign=aic144&lat=17.4&lon=78.3'), ENV, { fetchImpl, cache });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('Access-Control-Allow-Origin'), 'https://fargems.example');
  assert.equal(first.headers.get('X-Cache'), 'MISS');
  assert.equal((await first.json()).destination.iata, 'HYD');
  assert.equal(sent.init.method, 'POST');
  assert.deepEqual(JSON.parse(sent.init.body).planes[0], { callsign: 'AIC144', lat: 17.4, lng: 78.3 });
  assert.match(sent.init.headers['User-Agent'], /FarGems/);
  const second = await handle(ROUTE('?callsign=AIC144&lat=18&lon=79'), ENV, { fetchImpl, cache });
  assert.equal(second.headers.get('X-Cache'), 'HIT');
  assert.equal(calls, 1, 'the second visitor did not cost an upstream request');
});

test('worker /route validates input and reports upstream failure', async () => {
  const { handle } = await W;
  const noFetch = async () => { throw new Error('must not be called'); };
  assert.equal((await handle(ROUTE('?callsign=%2E%2E&lat=1&lon=1'), ENV, { fetchImpl: noFetch, cache: fakeCache() })).status, 400);
  assert.equal((await handle(ROUTE('?callsign=UAL1&lat=abc&lon=1'), ENV, { fetchImpl: noFetch, cache: fakeCache() })).status, 400);
  const down = async () => new Response('', { status: 429 });
  assert.equal((await handle(ROUTE('?callsign=UAL1&lat=1&lon=1'), ENV, { fetchImpl: down, cache: fakeCache() })).status, 502);
});

test('worker /route remembers flights with no known route, for a shorter time', async () => {
  const { handle } = await W;
  const cache = fakeCache();
  const fetchImpl = async () => new Response('[]', { status: 200 });
  const res = await handle(ROUTE('?callsign=N123AB&lat=1&lon=1'), ENV, { fetchImpl, cache });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).destination, null);
  assert.match(res.headers.get('Cache-Control'), /max-age=600/);
});

test('tapping a flight beats a star drawn behind it', () => {
  assert.match(read('app.js'), /startsWith\('star:'\)/);
});
