'use strict';
// The local data proxy (npm run worker:dev) runs the real Worker code with an in-memory cache.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('the local proxy serves the Worker on localhost, caches, and honours the kill switch', async () => {
  const { startDevWorker } = await import('../scripts/dev-worker.mjs');
  let calls = 0;
  const fetchImpl = async () => { calls++; return new Response('{"ac":[{"hex":"abc123"}]}', { status: 200 }); };
  const server = await startDevWorker({ port: 0, env: { ALLOWED_ORIGINS: '' }, fetchImpl, quiet: true });
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const first = await fetch(base + '/aircraft?lat=17.4&lon=78.5', { headers: { Origin: 'http://localhost:8000' } });
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('access-control-allow-origin'), 'http://localhost:8000', 'local pages are always allowed');
    assert.equal(first.headers.get('x-cache'), 'MISS');
    assert.equal((await first.json()).ac[0].hex, 'abc123');
    const second = await fetch(base + '/aircraft?lat=17.41&lon=78.51', { headers: { Origin: 'http://localhost:8000' } });
    assert.equal(second.headers.get('x-cache'), 'HIT');
    assert.equal(calls, 1, 'the second request came from the cache');
    const other = await fetch(base + '/aircraft?lat=17.4&lon=78.5', { headers: { Origin: 'https://not-allowed.example' } });
    assert.equal(other.headers.get('access-control-allow-origin'), null, 'other origins are refused by the browser');
    assert.equal((await fetch(base + '/status')).status, 200);
    assert.equal((await fetch(base + '/nope')).status, 404);
  } finally { server.close(); }
  const off = await startDevWorker({ port: 0, env: { ENABLED: 'false' }, fetchImpl, quiet: true });
  try { assert.equal((await fetch('http://127.0.0.1:' + off.address().port + '/aircraft?lat=1&lon=1')).status, 503); } finally { off.close(); }
});

test('npm run worker:dev exists and needs no packages', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['worker:dev'], 'node scripts/dev-worker.mjs');
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
});
