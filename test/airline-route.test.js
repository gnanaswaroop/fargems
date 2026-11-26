'use strict';
// A flight's card shows the airline, and the route with where it came from and where it is going given the same weight.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../lib/logic.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('airlineOf names the airline from the first three letters of the flight number', () => {
  assert.equal(L.airlineOf('AIC144'), 'Air India');
  assert.equal(L.airlineOf('IGO6E21'), 'IndiGo');
  assert.equal(L.airlineOf(' ual1 '), 'United Airlines', 'spaces and lower case do not matter');
  assert.equal(L.airlineOf('BAW256'), 'British Airways');
  assert.equal(L.airlineOf('SIA21'), 'Singapore Airlines');
  assert.equal(L.airlineOf('QTR8'), 'Qatar Airways');
  assert.equal(L.airlineOf('AXB1234'), 'Air India Express');
  assert.equal(L.airlineOf('VTI944'), 'Vistara');
  assert.equal(L.airlineOf('N123AB'), null, 'a registration is not an airline');
  assert.equal(L.airlineOf('ZZZ12'), null, 'an airline that is not in the list shows no name');
  assert.equal(L.airlineOf('AIC'), null, 'no number, no flight');
  assert.equal(L.airlineOf(''), null);
  assert.equal(L.airlineOf(null), null);
  assert.equal(L.airlineOf(undefined), null);
});

test('the airline list is well formed and covers the carriers over India', () => {
  const keys = Object.keys(L.AIRLINES);
  assert.ok(keys.length >= 120, keys.length + ' airlines');
  for (const k of keys) { assert.match(k, /^[A-Z]{3}$/, k); assert.ok(L.AIRLINES[k].trim().length >= 2, k); }
  for (const k of ['AIC', 'IGO', 'SEJ', 'VTI', 'AXB', 'AKJ', 'UAE', 'QTR', 'ETD', 'SIA', 'THY', 'BAW', 'DLH', 'AFR', 'KLM', 'UAL', 'AAL', 'DAL', 'FDX', 'UPS']) assert.ok(L.AIRLINES[k], k);
});

test('routeStops gives both ends the same shape: a code and a place', () => {
  const route = { origin: { iata: 'HYD', icao: 'VOHS', name: 'Rajiv Gandhi International Airport', city: 'Hyderabad' }, destination: { iata: 'DEL', name: 'Indira Gandhi International Airport', city: 'Delhi' } };
  assert.deepEqual(L.routeStops(route), { from: { code: 'HYD', place: 'Hyderabad' }, to: { code: 'DEL', place: 'Delhi' } });
  assert.deepEqual(L.routeStops({ origin: { icao: 'EGLL', name: 'Heathrow' }, destination: { iata: 'JFK', name: 'John F Kennedy', city: '' } }), { from: { code: 'EGLL', place: 'Heathrow' }, to: { code: 'JFK', place: 'John F Kennedy' } }, 'the ICAO code and the name when the others are missing');
  assert.deepEqual(L.routeStops({ origin: null, destination: { iata: 'DEL', city: 'Delhi' } }), { from: null, to: { code: 'DEL', place: 'Delhi' } }, 'an unknown start stays unknown');
  assert.deepEqual(L.routeStops({ destination: null }), { from: null, to: null });
  assert.deepEqual(L.routeStops(null), { from: null, to: null });
  assert.deepEqual(L.routeStops({ origin: {}, destination: { iata: 'DEL' } }), { from: null, to: { code: 'DEL', place: '' } }, 'an empty airport is unknown');
});

test('the card shows the airline under the name and the route as two equal ends; the list and the share text have the airline too', () => {
  const app = read('app.js'), css = read('style.css');
  assert.match(app, /const airline = o\.kind === 'air' && o\.ac \? H\.airlineOf\(o\.ac\.call\) : null, airlineLine = airline \? `<p class="airline">\$\{esc\(airline\)\}<\/p>` : '';/);
  assert.match(app, /<h3>\$\{title\}<\/h3>\$\{nv\}\$\{airlineLine\}\$\{lead\}\$\{routeBlock\}<dl>/, 'the airline right under the name (after a not-visible line, when there is one), the route before the facts');
  assert.match(app, /<h3>\$\{title\}<\/h3>\$\{nv\}\$\{airlineLine\}\$\{routeBlock\}<dl>/, 'and in the camera view');
  assert.match(app, /end\('From', st\.from\)\}<span class="arrow" aria-hidden="true">→<\/span>\$\{end\('To', st\.to\)/, 'From and To are drawn by the same function');
  assert.doesNotMatch(app, /kv\('Flying to'/, 'no more heading on the destination alone');
  assert.doesNotMatch(app, /<small class="muted">from \$/, 'no more greyed-out start');
  assert.match(app, /class="airline-name"/, 'the airline in the list rows');
  assert.match(app, /function shareRoute\(a\)/);
  assert.match(css, /\.route \{ display: grid; grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\);/);
  assert.match(css, /\.route \.stop b \{ font-size: 16px;/, 'one size for both');
  assert.doesNotMatch(css.match(/\.route \.stop b\.unknown \{[^}]*\}/)[0], /font-size/, 'an unknown end is only lighter, not smaller');
});
