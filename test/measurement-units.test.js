'use strict';
// Metric, imperial and aviation units, chosen in Settings (by language when nothing is saved).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../lib/logic.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('parseUnits uses the saved choice, else the language', () => {
  assert.equal(L.parseUnits('imperial', 'en-IN'), 'imperial');
  assert.equal(L.parseUnits('aviation', 'hi-IN'), 'aviation');
  assert.equal(L.parseUnits('metric', 'en-US'), 'metric', 'a saved choice wins');
  assert.equal(L.parseUnits(null, 'en-US'), 'imperial');
  assert.equal(L.parseUnits('nonsense', 'en-GB'), 'metric');
  assert.equal(L.parseUnits(undefined, 'te-IN'), 'metric');
  assert.equal(L.parseUnits(undefined, undefined), 'metric');
});

test('lengths, heights and speeds in each system', () => {
  assert.equal(L.lengthText(1049, 'metric'), '1,049 km');
  assert.equal(L.lengthText(1049, 'imperial'), '652 mi');
  assert.equal(L.lengthText(1049, 'aviation'), '566 nm');
  assert.equal(L.lengthText(12, undefined), '12 km');
  assert.equal(L.altitudeText(36000, 'metric'), '10,973 m');
  assert.equal(L.altitudeText(36000, 'imperial'), '36,000 ft');
  assert.equal(L.altitudeText(36000, 'aviation'), '36,000 ft');
  assert.equal(L.speedText(450, 'metric'), '833 km/h');
  assert.equal(L.speedText(450, 'imperial'), '518 mph');
  assert.equal(L.speedText(450, 'aviation'), '450 kt');
  assert.equal(L.formatDistance(384400, 'imperial'), '238,855 mi');
  assert.equal(L.formatDistance(384400), '384,400 km', 'the old call still works');
  assert.match(L.formatDistance(1.5e8, 'imperial'), /AU$/, 'far objects stay in astronomical units');
});

test('the detail card, the list and Settings use the chosen units', () => {
  const app = read('app.js'), s = read('settings.html'), js = read('settings.js');
  assert.match(app, /H\.altitudeText\(o\.altFt, state\.units\)/);
  assert.match(app, /H\.speedText\(a\.gs, state\.units\)/);
  assert.match(app, /H\.formatDistance\(o\.distKm, state\.units\)/);
  assert.match(app, /H\.lengthText\(H\.distanceKm\(a\.lat, a\.lon, d\.lat, d\.lon\), state\.units\)/);
  assert.doesNotMatch(app, /km\/h`/, 'no hard-coded km/h left');
  assert.match(s, /<select id="unitsSelect"[^>]*>[\s\S]*?value="metric"[\s\S]*?value="imperial"[\s\S]*?value="aviation"/);
  assert.match(js, /fg\.units/);
});
