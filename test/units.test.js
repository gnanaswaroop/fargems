'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../lib/logic.js');

test('celsius to fahrenheit and back', () => {
  assert.equal(L.cToF(0), 32);
  assert.equal(L.cToF(100), 212);
  assert.equal(L.cToF(-40), -40);
  assert.ok(Math.abs(L.fToC(L.cToF(21.5)) - 21.5) < 1e-9);
});

test('formatTemp shows the chosen unit, rounded, with the degree sign', () => {
  assert.equal(L.formatTemp(21.4, 'C'), '21°C');
  assert.equal(L.formatTemp(21.4, 'F'), '71°F');
  assert.equal(L.formatTemp(-3.6, 'C'), '-4°C');
  assert.equal(L.formatTemp(null, 'C'), '–', 'missing temperature shows a dash');
  assert.equal(L.formatTemp(NaN, 'F'), '–');
});

test('parseUnit accepts only C or F and defaults to C', () => {
  assert.equal(L.parseUnit('F'), 'F');
  assert.equal(L.parseUnit('C'), 'C');
  assert.equal(L.parseUnit('K'), 'C');
  assert.equal(L.parseUnit(null), 'C');
});

test('nextUnit flips between C and F', () => {
  assert.equal(L.nextUnit('C'), 'F');
  assert.equal(L.nextUnit('F'), 'C');
  assert.equal(L.nextUnit('bogus'), 'F', 'unknown values start from C, so the next one is F');
});
