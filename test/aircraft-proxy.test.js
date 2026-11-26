'use strict';
// Tests for the Cloudflare Worker that proxies aircraft data. The worker logic is pure
// (dependencies are passed in), so it runs in Node with fake fetch and cache objects.
const test = require('node:test');
const { beforeEach } = test;
const assert = require('node:assert/strict');

const W = import('../worker/aircraft-proxy.mjs');
// The worker remembers which providers are cooling down, so every test starts with a clean slate.
beforeEach(async () => (await W).resetHealth());

test('cellKey groups nearby points into the same cache cell', async () => {
  const { cellKey } = await W;
  assert.equal(cellKey(17.44, 78.38, 150), cellKey(17.45, 78.39, 150), 'points in one 0.25 degree cell share a key');
  assert.notEqual(cellKey(17.44, 78.38, 150), cellKey(17.9, 78.38, 150), 'a point in another cell does not');
  assert.notEqual(cellKey(17.44, 78.38, 150), cellKey(17.44, 78.38, 100), 'radius is part of the key');
});

test('parseQuery accepts valid coordinates and clamps the radius', async () => {
  const { parseQuery } = await W;
  assert.deepEqual(parseQuery(new URL('https://x/aircraft?lat=17.44&lon=78.38&r=150')), { lat: 17.44, lon: 78.38, r: 150 });
  assert.equal(parseQuery(new URL('https://x/aircraft?lat=17.44&lon=78.38')).r, 150, 'default radius');
  assert.equal(parseQuery(new URL('https://x/aircraft?lat=17.44&lon=78.38&r=9999')).r, 250, 'radius is capped');
  const r = (v) => parseQuery(new URL('https://x/aircraft?lat=17.44&lon=78.38&r=' + v)).r;
  assert.deepEqual([r(100.001), r(100.002), r(101), r(100)], [125, 125, 125, 100], 'made-up radii fall into a few steps, so they share one cache entry');
  assert.equal(r(0.4), 25);
});

test('parseQuery rejects missing, non-numeric or out-of-range coordinates', async () => {
  const { parseQuery } = await W;
  assert.equal(parseQuery(new URL('https://x/aircraft?lat=abc&lon=1')), null);
  assert.equal(parseQuery(new URL('https://x/aircraft?lon=1')), null);
  assert.equal(parseQuery(new URL('https://x/aircraft?lat=91&lon=0')), null);
  assert.equal(parseQuery(new URL('https://x/aircraft?lat=0&lon=181')), null);
});

test('corsHeaders echoes only allowed origins', async () => {
  const { corsHeaders } = await W;
  const env = { ALLOWED_ORIGINS: 'https://fargems.example, https://other.example' };
  assert.equal(corsHeaders('https://fargems.example', env)['Access-Control-Allow-Origin'], 'https://fargems.example');
  assert.equal(corsHeaders('https://evil.example', env)['Access-Control-Allow-Origin'], undefined);
  assert.equal(corsHeaders('http://localhost:8080', env)['Access-Control-Allow-Origin'], 'http://localhost:8080', 'local development is allowed');
  assert.equal(corsHeaders(null, env)['Access-Control-Allow-Origin'], undefined);
});

function fakeCache() {
  const m = new Map();
  return {
    match: async (req) => (m.has(req.url) ? m.get(req.url).clone() : undefined),
    put: async (req, res) => { m.set(req.url, res.clone()); },
    size: () => m.size,
  };
}

function fakeFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, ua: init && init.headers && init.headers['User-Agent'] });
    const r = responses.shift();
    if (!r) throw new Error('no response scripted');
    return new Response(r.body, { status: r.status || 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { fetchImpl, calls };
}

const ENV = { ALLOWED_ORIGINS: 'https://fargems.example' };
const GET = (q, origin = 'https://fargems.example') =>
  new Request('https://worker.example/aircraft' + q, { headers: origin ? { Origin: origin } : {} });

test('handle returns the first provider that answers, with CORS and a short cache lifetime', async () => {
  const { handle } = await W;
  const cache = fakeCache();
  const { fetchImpl, calls } = fakeFetch([{ body: '{"ac":[{"hex":"abc123"}]}' }]);
  const res = await handle(GET('?lat=17.44&lon=78.38&r=150'), ENV, { fetchImpl, cache });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://fargems.example');
  assert.match(res.headers.get('Cache-Control'), /max-age=30/);
  assert.equal((await res.json()).ac[0].hex, 'abc123');
  assert.match(calls[0].url, /api\.adsb\.lol\/v2\/point\//, 'adsb.lol is tried first');
});

test('handle falls back to the next provider when one fails', async () => {
  const { handle } = await W;
  const { fetchImpl, calls } = fakeFetch([{ status: 429, body: 'slow down' }, { body: '{"ac":[]}' }]);
  const res = await handle(GET('?lat=17.44&lon=78.38'), ENV, { fetchImpl, cache: fakeCache() });
  assert.equal(res.status, 200);
  assert.match(calls[1].url, /opendata\.adsb\.fi/, 'adsb.fi is the next provider');
});

test('handle serves a cached area without calling any provider again', async () => {
  const { handle } = await W;
  const cache = fakeCache();
  const first = fakeFetch([{ body: '{"ac":[]}' }]);
  await handle(GET('?lat=17.44&lon=78.38'), ENV, { fetchImpl: first.fetchImpl, cache });
  const second = fakeFetch([]); // would throw if called
  const res = await handle(GET('?lat=17.45&lon=78.39'), ENV, { fetchImpl: second.fetchImpl, cache });
  assert.equal(res.status, 200, 'nearby point is served from the same cell');
  assert.equal(second.calls.length, 0, 'no upstream request for a cached cell');
});

test('handle identifies the project to providers without a personal contact', async () => {
  const { handle } = await W;
  const { fetchImpl, calls } = fakeFetch([{ body: '{"ac":[]}' }]);
  await handle(GET('?lat=17.44&lon=78.38'), ENV, { fetchImpl, cache: fakeCache() });
  assert.match(calls[0].ua, /FarGems/);
  assert.match(calls[0].ua, /github\.com\/gnanaswaroop\/fargems/);
  assert.ok(!/@/.test(calls[0].ua), 'no email address in the user agent');
});

test('handle returns 400 for bad parameters and 502 when every provider fails', async () => {
  const { handle } = await W;
  const bad = await handle(GET('?lat=oops&lon=1'), ENV, { fetchImpl: fakeFetch([]).fetchImpl, cache: fakeCache() });
  assert.equal(bad.status, 400);
  const down = fakeFetch([{ status: 500 }, { status: 500 }]);
  const res = await handle(GET('?lat=17.44&lon=78.38'), ENV, { fetchImpl: down.fetchImpl, cache: fakeCache() });
  assert.equal(res.status, 502);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://fargems.example', 'errors still carry CORS so the page can read them');
});

test('handle answers preflight requests from allowed origins and refuses other methods', async () => {
  const { handle } = await W;
  const pre = await handle(new Request('https://worker.example/aircraft', { method: 'OPTIONS', headers: { Origin: 'https://fargems.example' } }), ENV, { fetchImpl: fakeFetch([]).fetchImpl, cache: fakeCache() });
  assert.equal(pre.status, 204);
  const post = await handle(new Request('https://worker.example/aircraft?lat=1&lon=1', { method: 'POST' }), ENV, { fetchImpl: fakeFetch([]).fetchImpl, cache: fakeCache() });
  assert.equal(post.status, 405);
});

test('a script that asks too often is told to wait; people and /status are not limited', async () => {
  const { handle, tooMany } = await W;
  const hits = new Map(), t = 1000000;
  for (let i = 0; i < 120; i++) assert.equal(tooMany('1.2.3.4', hits, t + i), false);
  assert.equal(tooMany('1.2.3.4', hits, t + 200), true, 'the 121st request in a minute');
  assert.equal(tooMany('5.6.7.8', hits, t + 200), false, 'another address is not affected');
  assert.equal(tooMany('1.2.3.4', hits, t + 61000), false, 'a minute later it may ask again');
  assert.equal(tooMany(null, hits, t), false);
  const req = (path) => new Request('https://relay.example' + path, { headers: { 'CF-Connecting-IP': '9.9.9.9' } });
  const busy = new Map([['9.9.9.9', Array.from({ length: 130 }, () => Date.now())]]);
  const res = await handle(req('/aircraft?lat=1&lon=2'), {}, { hits: busy, cache: {}, fetchImpl: () => { throw new Error('no provider is called'); } });
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('Retry-After'), '60');
  const status = await handle(req('/status'), {}, { hits: busy, cache: {} });
  assert.equal(status.status, 200);
});
