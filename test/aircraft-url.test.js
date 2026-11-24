'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../lib/logic.js');

test('aircraftProxyUrl is null when no proxy is configured', () => {
  assert.equal(L.aircraftProxyUrl('', 17.46, 78.33), null);
  assert.equal(L.aircraftProxyUrl(undefined, 17.46, 78.33), null);
});

test('aircraftProxyUrl adds the point and radius to the proxy address', () => {
  assert.equal(
    L.aircraftProxyUrl('https://proxy.example/aircraft', 17.46, 78.33, 150),
    'https://proxy.example/aircraft?lat=17.460&lon=78.330&r=150',
  );
  assert.equal(
    L.aircraftProxyUrl('https://proxy.example/aircraft?key=1', 17.46, 78.33),
    'https://proxy.example/aircraft?key=1&lat=17.460&lon=78.330&r=150',
    'an existing query string is extended, not replaced',
  );
});
