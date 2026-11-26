'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../lib/logic.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('the browser does not try providers that refuse it', () => {
  assert.doesNotMatch(read('app.js'), /airplanes\.live/);
  assert.doesNotMatch(read('settings.html'), /airplanes\.live/);
});

test('the relay gets a rounded area and, for a route, only the callsign', () => {
  assert.equal(L.aircraftProxyUrl('https://r.example/aircraft', 17.44351, 78.37724, 150), 'https://r.example/aircraft?lat=17.44&lon=78.38&r=150');
  assert.equal(L.routeProxyUrl('https://r.example/aircraft', 'aic144', 17.44351, 78.37724), 'https://r.example/route?callsign=AIC144');
  assert.match(read('index.html'), /Only a rounded area \(about 1 km\) is sent/);
});
