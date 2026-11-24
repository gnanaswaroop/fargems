'use strict';
// Runs sw.js in a sandbox with fake caches and fetch, to check how it serves files.
// Own files must come from the network first (so a deploy shows up straight away),
// and only fall back to the cache when offline.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
const ORIGIN = 'https://site.example';

function sandbox({ cached = {}, fetchImpl }) {
  const store = new Map(Object.entries(cached).map(([u, body]) => [u, new Response(body)]));
  const listeners = {};
  const calls = { fetch: [], deleted: [] };
  const cache = {
    match: async (req) => { const r = store.get(typeof req === 'string' ? req : req.url); return r ? r.clone() : undefined; },
    put: async (req, res) => { store.set(typeof req === 'string' ? req : req.url, res.clone()); },
    addAll: async () => {},
  };
  const caches = {
    open: async () => cache,
    keys: async () => ['fargems-v1', 'fargems-old', 'current'],
    delete: async (k) => { calls.deleted.push(k); return true; },
  };
  const ctx = vm.createContext({
    self: { location: { origin: ORIGIN }, addEventListener: (t, fn) => { listeners[t] = fn; }, skipWaiting: () => {}, clients: { claim: async () => {} } },
    caches,
    fetch: async (req, init) => { calls.fetch.push({ url: req.url || String(req), init }); return fetchImpl(req, init); },
    URL, Response, Request, Promise,
  });
  vm.runInContext(SRC, ctx);
  const version = vm.runInContext('VERSION', ctx);
  const get = async (url) => {
    let p;
    listeners.fetch({ request: new Request(url), respondWith: (x) => { p = x; } });
    return p ? p : null;
  };
  return { get, store, calls, listeners, version };
}

test('own files come from the network first, so a new deploy shows straight away', async () => {
  const sb = sandbox({
    cached: { [ORIGIN + '/app.js']: 'OLD' },
    fetchImpl: async () => new Response('NEW'),
  });
  const res = await sb.get(ORIGIN + '/app.js');
  assert.equal(await res.text(), 'NEW', 'the fresh file wins over the cached one');
});

test('own files are revalidated, not read from the browser HTTP cache', async () => {
  const sb = sandbox({ cached: {}, fetchImpl: async () => new Response('NEW') });
  await sb.get(ORIGIN + '/style.css');
  const call = sb.calls.fetch[0];
  assert.equal(call.init && call.init.cache, 'no-cache', 'fetch is sent with cache: no-cache');
});

test('the fresh copy replaces the cached copy', async () => {
  const sb = sandbox({ cached: { [ORIGIN + '/app.js']: 'OLD' }, fetchImpl: async () => new Response('NEW') });
  const res = await sb.get(ORIGIN + '/app.js');
  await res.text();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(await sb.store.get(ORIGIN + '/app.js').text(), 'NEW');
});

test('offline, the cached copy is served', async () => {
  const sb = sandbox({
    cached: { [ORIGIN + '/app.js']: 'CACHED' },
    fetchImpl: async () => { throw new TypeError('offline'); },
  });
  const res = await sb.get(ORIGIN + '/app.js');
  assert.equal(await res.text(), 'CACHED');
});

test('a server error does not replace a good cached copy', async () => {
  const sb = sandbox({
    cached: { [ORIGIN + '/app.js']: 'CACHED' },
    fetchImpl: async () => new Response('oops', { status: 500 }),
  });
  const res = await sb.get(ORIGIN + '/app.js');
  assert.equal(await res.text(), 'CACHED', 'falls back to the cache on a bad response');
});

test('the CDN libraries stay cache-first, since their URLs are versioned', async () => {
  const cdn = 'https://cdn.jsdelivr.net/npm/satellite.js@5.0.0/dist/satellite.min.js';
  const sb = sandbox({ cached: { [cdn]: 'LIB' }, fetchImpl: async () => { throw new Error('should not be called'); } });
  const res = await sb.get(cdn);
  assert.equal(await res.text(), 'LIB');
  assert.equal(sb.calls.fetch.length, 0);
});

test('data APIs are never intercepted', async () => {
  const sb = sandbox({ cached: {}, fetchImpl: async () => new Response('x') });
  assert.equal(await sb.get('https://api.example/data'), null);
});

test('activating the worker deletes the older caches, so stale files do not linger', async () => {
  const sb = sandbox({ cached: {}, fetchImpl: async () => new Response('x') });
  let done;
  sb.listeners.activate({ waitUntil: (p) => { done = p; } });
  await done;
  assert.ok(sb.calls.deleted.includes('fargems-v1'), 'the old v1 cache is removed');
  assert.ok(!sb.calls.deleted.includes(sb.version), 'the current cache is kept');
});

test('the cache name was bumped so the previous stale cache is dropped', () => {
  const sb = sandbox({ cached: {}, fetchImpl: async () => new Response('x') });
  assert.notEqual(sb.version, 'fargems-v1');
});
