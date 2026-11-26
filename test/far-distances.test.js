'use strict';
// Very long distances (the Sun, planets): short forms, astronomical units, or light travel time.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../lib/logic.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('space distances are short, in the visitor\'s units', () => {
  assert.equal(L.formatDistance(149597870.7, 'metric'), '149.6 million km');
  assert.equal(L.formatDistance(149597870.7, 'imperial'), '93.0 million mi');
  assert.equal(L.formatDistance(149597870.7, 'aviation'), '80.8 million nm');
  assert.equal(L.formatDistance(4.5e9, 'metric'), '4.5 billion km');
  assert.equal(L.formatDistance(4.5e9, 'imperial'), '2.8 billion mi');
  assert.equal(L.formatDistance(384400, 'metric'), '384,400 km', 'the Moon keeps the full number');
  assert.equal(L.formatDistance(999999, 'metric'), '999,999 km', 'just under a million');
  assert.equal(L.formatDistance(1e6, 'metric'), '1.0 million km');
});

test('astronomical units and light travel time can be chosen', () => {
  assert.equal(L.formatDistance(149597870.7, 'metric', 'au'), '1.00 AU');
  assert.equal(L.formatDistance(7.78e8, 'metric', 'au'), '5.20 AU');
  assert.equal(L.formatDistance(4.5e9, 'metric', 'au'), '30.1 AU');
  assert.equal(L.formatDistance(149597870.7, 'metric', 'light'), '8 min 19 s by light');
  assert.equal(L.formatDistance(384400, 'metric', 'au'), '384,400 km', 'near things stay in km or miles');
  assert.equal(L.formatDistance(384400, 'imperial', 'light'), '238,855 mi', 'and are not shown as light time');
  assert.equal(L.formatDistance(null, 'metric', 'au'), 'distance unknown');
});

test('light travel time reads naturally', () => {
  assert.equal(L.lightTimeText(384400), '1.3 s');
  assert.equal(L.lightTimeText(3e6), '10 s');
  assert.equal(L.lightTimeText(149597870.7), '8 min 19 s');
  assert.equal(L.lightTimeText(299792.458 * 120), '2 min');
  assert.equal(L.lightTimeText(299792.458 * 119.7), '2 min', 'rounds up into the next minute');
  assert.equal(L.lightTimeText(4.5e9), '4 h 10 min');
  assert.equal(L.lightTimeText(299792.458 * 3600), '1 h');
  assert.equal(L.lightTimeText(-5), '');
  assert.equal(L.lightTimeText(NaN), '');
});

test('parseFar accepts the three choices and defaults to kilometres or miles', () => {
  assert.equal(L.parseFar('au'), 'au');
  assert.equal(L.parseFar('light'), 'light');
  assert.equal(L.parseFar('units'), 'units');
  assert.equal(L.parseFar('x'), 'units');
  assert.equal(L.parseFar(null), 'units');
  assert.equal(L.AU_KM, 149597870.7);
});

test('Settings has the choice and says what an AU is; the list and the card use it', () => {
  const s = read('settings.html'), js = read('settings.js'), app = read('app.js');
  assert.match(s, /<select id="farSelect"[^>]*aria-describedby="farHelp"[\s\S]*?value="units"[\s\S]*?value="au"[\s\S]*?value="light"/);
  assert.match(s, /id="farHelp"[^>]*>One AU is the average distance from the Earth to the Sun, about 150 million km \(93 million miles\)/);
  assert.match(js, /fg\.far/);
  assert.match(app, /H\.formatDistance\(o\.distKm, state\.units, state\.far\)/);
  assert.match(app, /kv\('Light takes', o\.distKm != null \? H\.lightTimeText\(o\.distKm\) : null\)/);
  assert.match(app, /<abbr title="astronomical unit: the average distance from the Earth to the Sun, about 150 million km">AU<\/abbr>/);
});
