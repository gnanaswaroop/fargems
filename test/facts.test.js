'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const F = require('../lib/facts.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('every planet, the Sun and the Moon have a fact', () => {
  for (const name of ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune']) {
    const t = F.factFor({ kind: 'body', name });
    assert.ok(t && t.length > 30 && t.length < 220, name + ': ' + t);
  }
});

test('every star the app draws has a fact', () => {
  const app = read('app.js');
  const block = app.slice(app.indexOf('const STARS = ['), app.indexOf('];', app.indexOf('const STARS = [')));
  const names = [...block.matchAll(/\[\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(names.length >= 15, 'found the star list: ' + names.length);
  for (const name of names) assert.ok(F.factFor({ kind: 'star', name }), name + ' has a fact');
});

test('a flight gets a fact about its type, and nothing when the type is unknown', () => {
  assert.match(F.factFor({ kind: 'air', ac: { type: 'A388' } }), /largest passenger airliner/);
  assert.match(F.factFor({ kind: 'air', ac: { type: 'b738' } }), /737-800/);
  assert.equal(F.factFor({ kind: 'air', ac: { type: 'ZZZZ' } }), null);
  assert.equal(F.factFor({ kind: 'air', ac: {} }), null);
  assert.equal(F.factFor({ kind: 'air' }), null);
});

test('satellites: named ones get their story, others get how long an orbit takes', () => {
  assert.match(F.factFor({ kind: 'sat', name: 'ISS (ZARYA)', altKm: 420 }), /International Space Station/);
  assert.match(F.factFor({ kind: 'sat', name: 'STARLINK-1007' }), /internet/);
  assert.match(F.factFor({ kind: 'sat', name: 'CZ-4C R/B', altKm: 700 }), /rocket stage/);
  const t = F.factFor({ kind: 'sat', name: 'SOME SAT 7', altKm: 850 });
  assert.match(t, /^At 850 km up, it goes once around the Earth in about 10[0-9] minutes\.$/, t);
  assert.match(F.factFor({ kind: 'sat', name: 'NOAA 19' }), /Weather/);
  assert.equal(F.factFor({ kind: 'sat', name: 'UNKNOWN' }), null, 'no altitude, nothing to say');
});

test('nothing for what is not an object, and no fact says generic or example', () => {
  assert.equal(F.factFor(null), null);
  assert.equal(F.factFor({ kind: 'other' }), null);
  assert.match(F.factFor({ kind: 'met', name: 'Perseids' }), /dust/);
});

test('the facts load in the viewer, work offline, and sit behind More in the card', () => {
  assert.match(read('viewer.html'), /<script defer src="lib\/facts\.js"><\/script>/);
  assert.match(read('sw.js'), /'lib\/facts\.js'/);
  assert.match(read('app.js'), /<p class="fact"><b>Did you know\?<\/b>/);
  assert.match(read('app.js'), /factHtml = cardMore && fact/, 'only in the open card');
});
