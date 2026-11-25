'use strict';
// How the Cloudflare Worker copes with throttled, blocked and failing providers: cooldowns, fallback providers,
// stale answers, route and satellite fallbacks. Everything runs in Node with fake fetch, cache and clock.
const test = require('node:test');
const { beforeEach } = test;
const assert = require('node:assert/strict');

const W = import('../worker/aircraft-proxy.mjs');
beforeEach(async () => (await W).resetHealth());

const ENV = { ALLOWED_ORIGINS: 'https://fargems.example' };
const get = (path) => new Request('https://worker.example' + path, { headers: { Origin: 'https://fargems.example' } });

function fakeCache() {
  const m = new Map();
  return {
    match: async (req) => (m.has(req.url) ? m.get(req.url).clone() : undefined),
    put: async (req, res) => { m.set(req.url, res.clone()); },
    keys: () => [...m.keys()],
  };
}
function clock(start = 1_000_000) { let t = start; const f = () => t; f.advance = (s) => { t += s * 1000; }; return f; }

// A fetch that answers by URL: each rule is [substring, response | function]. Records the URLs it was asked for.
function router(rules) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const rule = rules.find(([needle]) => url.includes(needle));
    if (!rule) throw new Error('no rule for ' + url);
    const r = typeof rule[1] === 'function' ? rule[1](url) : rule[1];
    if (r instanceof Error) throw r;
    return new Response(r.body ?? '', { status: r.status ?? 200, headers: r.headers || {} });
  };
  return { fetchImpl, calls, hits: (needle) => calls.filter((u) => u.includes(needle)).length };
}
const OK_AC = { body: '{"ac":[{"hex":"abc123","lat":1,"lon":2}]}' };
const AC = '/aircraft?lat=17.46&lon=78.33';

test('parseRetryAfter reads seconds and HTTP dates', async () => {
  const { parseRetryAfter } = await W;
  assert.equal(parseRetryAfter('30'), 30);
  assert.equal(parseRetryAfter(null), null);
  assert.equal(parseRetryAfter('soon'), null);
  assert.equal(parseRetryAfter(new Date(1_060_000).toUTCString(), 1_000_000), 60);
  assert.equal(parseRetryAfter(new Date(900_000).toUTCString(), 1_000_000), 0, 'a date in the past means now');
});

test('cooldowns: throttled waits as asked (capped), blocked waits an hour, other failures back off and double', async () => {
  const { cooldownMs } = await W;
  assert.equal(cooldownMs({ status: 429, retryAfter: 20 }, 1), 20_000);
  assert.equal(cooldownMs({ status: 429 }, 1), 60_000, 'no Retry-After: a minute');
  assert.equal(cooldownMs({ status: 503, retryAfter: 99999 }, 1), 600_000, 'capped at ten minutes');
  assert.equal(cooldownMs({ status: 403 }, 1), 3_600_000);
  assert.equal(cooldownMs({ status: 401 }, 1), 3_600_000);
  assert.equal(cooldownMs({ status: 500 }, 1), 15_000);
  assert.equal(cooldownMs({ status: 500 }, 2), 30_000);
  assert.equal(cooldownMs({ kind: 'timeout' }, 3), 60_000);
  assert.equal(cooldownMs({ kind: 'timeout' }, 20), 300_000, 'capped at five minutes');
});

test('a throttled provider is skipped until its Retry-After has passed, then tried again', async () => {
  const { handle } = await W;
  const now = clock(), health = new Map();
  const net = router([
    ['api.adsb.lol', { status: 429, headers: { 'Retry-After': '30' } }],
    ['opendata.adsb.fi', OK_AC],
  ]);
  // different cells so the cache does not answer
  await handle(get('/aircraft?lat=10&lon=10'), ENV, { fetchImpl: net.fetchImpl, cache: fakeCache(), health, now });
  assert.equal(net.hits('adsb.lol'), 1);
  await handle(get('/aircraft?lat=20&lon=20'), ENV, { fetchImpl: net.fetchImpl, cache: fakeCache(), health, now });
  assert.equal(net.hits('adsb.lol'), 1, 'adsb.lol was left alone while cooling down');
  assert.equal(net.hits('adsb.fi'), 2);
  now.advance(31);
  await handle(get('/aircraft?lat=30&lon=30'), ENV, { fetchImpl: net.fetchImpl, cache: fakeCache(), health, now });
  assert.equal(net.hits('adsb.lol'), 2, 'tried again after the cooldown');
});

test('a blocked provider (HTTP 403) is left alone for an hour', async () => {
  const { handle } = await W;
  const now = clock(), health = new Map();
  const net = router([['api.adsb.lol', { status: 403, body: 'contact us' }], ['opendata.adsb.fi', OK_AC]]);
  await handle(get('/aircraft?lat=10&lon=10'), ENV, { fetchImpl: net.fetchImpl, cache: fakeCache(), health, now });
  now.advance(3000);
  await handle(get('/aircraft?lat=20&lon=20'), ENV, { fetchImpl: net.fetchImpl, cache: fakeCache(), health, now });
  assert.equal(net.hits('adsb.lol'), 1, 'still blocked after 50 minutes');
  now.advance(700);
  await handle(get('/aircraft?lat=30&lon=30'), ENV, { fetchImpl: net.fetchImpl, cache: fakeCache(), health, now });
  assert.equal(net.hits('adsb.lol'), 2, 'asked again after an hour');
});

test('a timeout, a network error and a 200 with an HTML page all move on to the next provider', async () => {
  const { handle } = await W;
  const timeout = Object.assign(new Error('slow'), { name: 'TimeoutError' });
  for (const first of [timeout, new Error('connection reset'), { body: '<html>maintenance</html>' }, { body: '{"error":"nope"}' }]) {
    const net = router([['api.adsb.lol', first], ['opendata.adsb.fi', OK_AC]]);
    const res = await handle(get(AC), ENV, { fetchImpl: net.fetchImpl, cache: fakeCache(), health: new Map() });
    assert.equal(res.status, 200, String(first.message || first.body));
    assert.equal(res.headers.get('X-Provider'), 'adsb.fi');
  }
});

test('the third provider (OpenSky) answers in the same shape as the others when the first two fail', async () => {
  const { handle } = await W;
  const opensky = JSON.stringify({ time: 1700000000, states: [
    ['a735d7', 'ASA427  ', 'United States', 1, 1, -122.4955, 47.1076, 3497.58, false, 163.29, 7.06, -7.15, null, 3482.34, '4713', false, 0],
    ['abc999', 'TAXI1   ', 'United States', 1, 1, -122.3, 47.4, null, true, 5, 90, 0, null, null, '1', false, 0],
    ['nopos1', 'NOPOS   ', 'X', 1, 1, null, null, 100, false, 1, 1, 1, null, 100, '1', false, 0],
  ] });
  const net = router([['api.adsb.lol', { status: 500 }], ['opendata.adsb.fi', { status: 502 }], ['opensky-network.org', { body: opensky }]]);
  const res = await handle(get('/aircraft?lat=47.6&lon=-122.3&r=50'), ENV, { fetchImpl: net.fetchImpl, cache: fakeCache(), health: new Map() });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('X-Provider'), 'opensky');
  const { ac } = await res.json();
  assert.equal(ac.length, 2, 'an aircraft with no position is dropped');
  assert.deepEqual(ac[0], { hex: 'a735d7', flight: 'ASA427', lat: 47.1076, lon: -122.4955, gs: 317, track: 7.06, baro_rate: -1407, alt_baro: 11475 });
  assert.equal(ac[1].alt_baro, 'ground');
  assert.match(net.calls.find((u) => u.includes('opensky')), /lamin=.*&lomin=.*&lamax=.*&lomax=/, 'asks for a box around the point');
});

test('the app\'s own parser reads every provider\'s answer', async () => {
  const L = require('../lib/logic.js');
  const { parseOpenSky } = await W;
  const out = JSON.parse(parseOpenSky(JSON.stringify({ time: 1, states: [['a735d7', 'ASA427 ', 'US', 1, 1, -122.4, 47.1, 3497.58, false, 163.29, 7.06, -7.15, null, 3482, '1', false, 0]] })));
  const [a] = L.parseV2(out);
  assert.equal(a.call, 'ASA427');
  assert.ok(a.altFt > 11000 && a.altFt < 12000);
  assert.ok(a.gs > 300 && a.gs < 330);
});

test('adsb.fi style answers ({ aircraft: [...] }) are returned as { ac: [...] }', async () => {
  const { handle } = await W;
  const net = router([['api.adsb.lol', { status: 500 }], ['opendata.adsb.fi', { body: '{"now":1.5,"aircraft":[{"hex":"zz"}]}' }]]);
  const res = await handle(get(AC), ENV, { fetchImpl: net.fetchImpl, cache: fakeCache(), health: new Map() });
  const j = await res.json();
  assert.equal(j.ac[0].hex, 'zz');
  assert.equal(j.aircraft, undefined);
});

test('when every provider is cooling down, the one that recovers first is tried, so an outage can end', async () => {
  const { handle } = await W;
  const now = clock(), health = new Map();
  const down = router([['', { status: 500 }]]);
  await handle(get('/aircraft?lat=10&lon=10'), ENV, { fetchImpl: down.fetchImpl, cache: fakeCache(), health, now });
  assert.equal(down.calls.length, 3, 'all three tried and failed');
  const back = router([['', OK_AC]]);
  const res = await handle(get('/aircraft?lat=20&lon=20'), ENV, { fetchImpl: back.fetchImpl, cache: fakeCache(), health, now });
  assert.equal(res.status, 200, 'answered although all three were cooling down');
  assert.equal(back.calls.length, 1, 'but only one was asked');
  assert.match(back.calls[0], /adsb\.lol/, 'the first to be tried again');
});

test('the answer keeps saying which provider it came from, also from the cache', async () => {
  const { handle } = await W;
  const cache = fakeCache(), health = new Map(), now = clock();
  const net = router([['api.adsb.lol', { status: 500 }], ['opendata.adsb.fi', OK_AC]]);
  const first = await handle(get(AC), ENV, { fetchImpl: net.fetchImpl, cache, health, now });
  assert.equal(first.headers.get('X-Cache'), 'MISS');
  now.advance(10);
  const second = await handle(get(AC), ENV, { fetchImpl: net.fetchImpl, cache, health, now });
  assert.equal(second.headers.get('X-Cache'), 'HIT');
  assert.equal(second.headers.get('X-Provider'), 'adsb.fi');
  assert.ok(Number(second.headers.get('Cache-Control').match(/max-age=(\d+)/)[1]) <= 20, 'tells the browser the time left, not the full lifetime');
});

test('when every provider fails, the last good answer is served as STALE for a while, then it is an error', async () => {
  const { handle } = await W;
  const cache = fakeCache(), health = new Map(), now = clock();
  const good = router([['', OK_AC]]);
  await handle(get(AC), ENV, { fetchImpl: good.fetchImpl, cache, health, now });
  const bad = router([['', { status: 500 }]]);
  now.advance(60); // past the 30 s fresh time, inside the stale window
  const stale = await handle(get(AC), ENV, { fetchImpl: bad.fetchImpl, cache, health, now });
  assert.equal(stale.status, 200);
  assert.equal(stale.headers.get('X-Cache'), 'STALE');
  assert.equal(stale.headers.get('X-Stale-Age'), '60');
  assert.equal((await stale.json()).ac[0].hex, 'abc123');
  health.clear();
  now.advance(300); // beyond the stale window: positions would be too old to be useful
  const gone = await handle(get(AC), ENV, { fetchImpl: bad.fetchImpl, cache, health, now });
  assert.equal(gone.status, 502);
});

test('a 502 says what each provider did, and asks the caller to wait a little', async () => {
  const { handle } = await W;
  const net = router([['api.adsb.lol', { status: 429 }], ['opendata.adsb.fi', { status: 403 }], ['opensky', new Error('down')]]);
  const res = await handle(get(AC), ENV, { fetchImpl: net.fetchImpl, cache: fakeCache(), health: new Map() });
  assert.equal(res.status, 502);
  assert.ok(Number(res.headers.get('Retry-After')) > 0);
  const j = await res.json();
  assert.deepEqual(j.tried.map((t) => [t.provider, t.failed]), [['adsb.lol', 'HTTP 429'], ['adsb.fi', 'HTTP 403'], ['opensky', 'network error']]);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://fargems.example');
});

test('/status shows which providers are cooling down and calls no provider', async () => {
  const { handle } = await W;
  const now = clock(), health = new Map();
  const net = router([['api.adsb.lol', { status: 429, headers: { 'Retry-After': '45' } }], ['opendata.adsb.fi', OK_AC]]);
  await handle(get(AC), ENV, { fetchImpl: net.fetchImpl, cache: fakeCache(), health, now });
  const before = net.calls.length;
  const res = await handle(get('/status'), ENV, { fetchImpl: net.fetchImpl, cache: fakeCache(), health, now });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(net.calls.length, before, 'no provider was called');
  assert.deepEqual(j.aircraft.map((p) => p.state), ['cooling down', 'ok', 'ok']);
  assert.equal(j.aircraft[0].reason, 'HTTP 429');
  assert.equal(j.aircraft[0].retryInSeconds, 45);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
});

/* ---------- routes ---------- */

const ADSBDB = JSON.stringify({ response: { flightroute: {
  origin: { iata_code: 'EWR', icao_code: 'KEWR', name: 'Newark Liberty', municipality: 'Newark', latitude: 40.69, longitude: -74.17 },
  destination: { iata_code: 'BOM', icao_code: 'VABB', name: 'Chhatrapati Shivaji', municipality: 'Mumbai', latitude: 19.09, longitude: 72.87 } } } });
const HEX_AIRPORT = (iata, icao, name, region) => ({ body: JSON.stringify({ country_code: 'XX', region_name: region, iata, icao, airport: name, latitude: 1.5, longitude: 2.5 }) });

test('route: when adsbdb fails, hexdb answers with the same shape', async () => {
  const { handle } = await W;
  const net = router([
    ['api.adsbdb.com', { status: 500 }],
    ['hexdb.io/callsign-route', { body: 'KEWR-VABB\n' }],
    ['airport/icao/KEWR', HEX_AIRPORT('EWR', 'KEWR', 'Newark Liberty', 'New Jersey')],
    ['airport/icao/VABB', HEX_AIRPORT('BOM', 'VABB', 'Chhatrapati Shivaji', 'Maharashtra')],
  ]);
  const res = await handle(get('/route?callsign=aic144'), ENV, { fetchImpl: net.fetchImpl, cache: fakeCache(), health: new Map() });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('X-Provider'), 'hexdb');
  const r = await res.json();
  assert.equal(r.callsign, 'AIC144');
  assert.equal(r.origin.iata, 'EWR');
  assert.equal(r.destination.iata, 'BOM');
  assert.equal(r.destination.city, 'Maharashtra');
  assert.equal(r.destination.lat, 1.5);
});

test('route: a flight adsbdb does not know is also asked of hexdb, and stays unknown only if both agree', async () => {
  const { handle } = await W;
  const only = router([['api.adsbdb.com', { status: 404, body: '{"response":"unknown callsign"}' }], ['hexdb.io/callsign-route', { status: 404, body: 'n/a' }]]);
  const none = await handle(get('/route?callsign=N123AB'), ENV, { fetchImpl: only.fetchImpl, cache: fakeCache(), health: new Map() });
  assert.equal(none.status, 200);
  assert.equal((await none.json()).destination, null);
  assert.match(none.headers.get('Cache-Control'), /max-age=600/, 'unknown flights are remembered for 10 minutes');
  assert.equal(only.hits('hexdb.io'), 1);
  const found = router([
    ['api.adsbdb.com', { status: 404 }], ['hexdb.io/callsign-route', { body: 'KEWR-VABB' }],
    ['airport/icao/KEWR', HEX_AIRPORT('EWR', 'KEWR', 'Newark', 'NJ')], ['airport/icao/VABB', HEX_AIRPORT('BOM', 'VABB', 'Mumbai', 'MH')],
  ]);
  const yes = await handle(get('/route?callsign=AIC144'), ENV, { fetchImpl: found.fetchImpl, cache: fakeCache(), health: new Map() });
  assert.equal((await yes.json()).destination.iata, 'BOM');
});

test('route: a known route is remembered for 30 minutes and a stale copy survives both providers failing', async () => {
  const { handle } = await W;
  const cache = fakeCache(), health = new Map(), now = clock();
  const good = router([['api.adsbdb.com', { body: ADSBDB }]]);
  const first = await handle(get('/route?callsign=AIC144'), ENV, { fetchImpl: good.fetchImpl, cache, health, now });
  assert.match(first.headers.get('Cache-Control'), /max-age=1800/);
  now.advance(3600);
  const down = router([['', { status: 500 }]]);
  const res = await handle(get('/route?callsign=AIC144'), ENV, { fetchImpl: down.fetchImpl, cache, health, now });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('X-Cache'), 'STALE');
  assert.equal((await res.json()).destination.iata, 'BOM');
});

/* ---------- satellites ---------- */

const TLE = 'ISS (ZARYA)\n1 25544U 98067A   26327.91294507  .00005691  00000+0  10921-3 0  9993\n2 25544  51.6322 229.6520 0007379  58.6021 301.5689 15.49568558596519\n';
const mirrorRule = ['tle.ivanstanojevic.me/api/tle/', (url) => ({ body: JSON.stringify({ name: 'SAT ' + url.split('/').pop(), line1: '1 25544U 98067A   26327.91294507  .00005691  00000+0  10921-3 0  9993', line2: '2 25544  51.6322 229.6520 0007379  58.6021 301.5689 15.49568558596519' }) })];

test('/tle serves the group from CelesTrak as plain text and shares it between visitors', async () => {
  const { handle } = await W;
  const cache = fakeCache(), health = new Map(), now = clock();
  const net = router([['celestrak.org', { body: TLE }]]);
  const first = await handle(get('/tle?group=stations'), ENV, { fetchImpl: net.fetchImpl, cache, health, now });
  assert.equal(first.status, 200);
  assert.match(first.headers.get('Content-Type'), /text\/plain/);
  assert.equal(await first.text(), TLE);
  assert.match(net.calls[0], /GROUP=stations&FORMAT=tle/);
  const second = await handle(get('/tle?group=stations'), ENV, { fetchImpl: net.fetchImpl, cache, health, now });
  assert.equal(second.headers.get('X-Cache'), 'HIT');
  assert.equal(net.calls.length, 1);
});

test('/tle rejects other groups, and a 200 that is not element sets counts as a failure', async () => {
  const { handle } = await W;
  const noFetch = router([]);
  assert.equal((await handle(get('/tle?group=../../etc'), ENV, { fetchImpl: noFetch.fetchImpl, cache: fakeCache(), health: new Map() })).status, 400);
  assert.equal((await handle(get('/tle'), ENV, { fetchImpl: noFetch.fetchImpl, cache: fakeCache(), health: new Map() })).status, 400);
  assert.equal(noFetch.calls.length, 0);
  const html = router([['celestrak.org', { body: '<html>Service Unavailable</html>' }], ['tle.ivanstanojevic.me', { status: 500 }], ['live.ariss.org', { status: 500 }]]);
  assert.equal((await handle(get('/tle?group=stations'), ENV, { fetchImpl: html.fetchImpl, cache: fakeCache(), health: new Map() })).status, 502);
});

test('/tle stations: with CelesTrak down, the mirror database supplies the space stations', async () => {
  const { handle } = await W;
  const net = router([['celestrak.org', { status: 503 }], mirrorRule]);
  const res = await handle(get('/tle?group=stations'), ENV, { fetchImpl: net.fetchImpl, cache: fakeCache(), health: new Map() });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('X-Provider'), 'tle-api');
  const text = await res.text();
  assert.equal((text.match(/^1 \d{5}/gm) || []).length, 4, 'ISS and three Tiangong modules');
  assert.match(text, /^SAT 25544$/m);
  assert.equal(net.hits('tle.ivanstanojevic.me'), 4);
});

test('/tle stations: the ISS-only feed is the last resort', async () => {
  const { handle } = await W;
  const net = router([['celestrak.org', { status: 503 }], ['tle.ivanstanojevic.me', { status: 500 }], ['live.ariss.org', { body: TLE }]]);
  const res = await handle(get('/tle?group=stations'), ENV, { fetchImpl: net.fetchImpl, cache: fakeCache(), health: new Map() });
  assert.equal(res.headers.get('X-Provider'), 'ariss');
  assert.equal(await res.text(), TLE);
});

test('/tle visual has no mirror, so the last copy is served for days when CelesTrak is down', async () => {
  const { handle } = await W;
  const cache = fakeCache(), health = new Map(), now = clock();
  const good = router([['celestrak.org', { body: TLE }]]);
  await handle(get('/tle?group=visual'), ENV, { fetchImpl: good.fetchImpl, cache, health, now });
  const down = router([['', { status: 503 }]]);
  now.advance(2 * 86400);
  const res = await handle(get('/tle?group=visual'), ENV, { fetchImpl: down.fetchImpl, cache, health, now });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('X-Cache'), 'STALE');
  assert.equal(down.calls.length, 1, 'only CelesTrak was tried (no mirror carries this group)');
  health.clear();
  now.advance(2 * 86400); // four days: too old
  assert.equal((await handle(get('/tle?group=visual'), ENV, { fetchImpl: down.fetchImpl, cache, health, now })).status, 502);
});

test('the kill switch still wins over every path, including /tle and /status', async () => {
  const { handle } = await W;
  const noFetch = router([]);
  for (const p of ['/tle?group=stations', '/status', '/route?callsign=UAL1', '/aircraft?lat=1&lon=1']) {
    const res = await handle(get(p), { ...ENV, ENABLED: 'false' }, { fetchImpl: noFetch.fetchImpl, cache: fakeCache(), health: new Map() });
    assert.equal(res.status, 503, p);
  }
  assert.equal(noFetch.calls.length, 0);
});

test('providers are not the ones that now refuse anonymous clients', async () => {
  const { AIRCRAFT_PROVIDERS } = await W;
  assert.deepEqual(AIRCRAFT_PROVIDERS.map((p) => p.name), ['adsb.lol', 'adsb.fi', 'opensky']);
});

/* ---------- the app side ---------- */

test('tleProxyUrl builds the satellite URL next to the aircraft URL', () => {
  const L = require('../lib/logic.js');
  assert.equal(L.tleProxyUrl('https://w.example/aircraft', 'stations'), 'https://w.example/tle?group=stations');
  assert.equal(L.tleProxyUrl('https://w.example/aircraft?x=1', 'visual'), 'https://w.example/tle?group=visual');
  assert.equal(L.tleProxyUrl('', 'stations'), null, 'no proxy, no proxy URL');
  assert.equal(L.tleProxyUrl('https://w.example/other', 'stations'), null, 'unknown URL shape');
  assert.equal(L.tleProxyUrl('https://w.example/aircraft', '../x'), null, 'only plain group names');
});

test('the app asks the proxy for satellite data first, then CelesTrak directly, and still falls back to its saved copy', () => {
  const fs = require('node:fs'), path = require('node:path');
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(app, /async function fetchTLE\(group\)/);
  assert.ok(app.indexOf('tleProxyUrl(AIRCRAFT_PROXY, group)') < app.indexOf('celestrak.org/NORAD/elements/gp.php'), 'proxy before CelesTrak');
  assert.match(app, /if \(cached\) return \{ sats: parseTLE\(cached\.text, group\), t: cached\.t \};/, 'the saved copy is still the last resort');
});

test('the Worker source has no backticks or template placeholders, so the exact file can be pasted into a dashboard or a raw string', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'worker', 'aircraft-proxy.mjs'), 'utf8');
  assert.equal(src.includes('`'), false);
  assert.equal(src.includes('${'), false);
});
