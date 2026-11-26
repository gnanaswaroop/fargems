'use strict';
// A permanent link to one object: opening it picks that object like a tap on the radar, and says so when it cannot be seen.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const K = require('../lib/permalink.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('every kind of object has a link that reads back to the same id', () => {
  const ids = ['sat:25544', 'air:4ca7b2', 'air:~1a2b3c', 'body:Mars', 'body:Moon', 'star:Alpha Centauri', 'met:Perseids', 'met:Eta Aquariids'];
  for (const id of ids) {
    const link = K.objectLink('https://example.test/app/viewer.html', id);
    assert.ok(link.startsWith('https://example.test/app/viewer.html#o='), link);
    assert.equal(K.parseLink(link.slice(link.indexOf('#'))), id, id);
  }
  assert.equal(K.objectLink('viewer.html', 'sat:25544'), 'viewer.html#o=sat:25544', 'the colon stays readable');
  assert.equal(K.objectLink('viewer.html', 'star:Alpha Centauri'), 'viewer.html#o=star:Alpha%20Centauri');
  assert.equal(K.objectLink('viewer.html#o=body:Sun', 'sat:25544'), 'viewer.html#o=sat:25544', 'an old link on the base is replaced');
  assert.equal(K.objectLink('', 'body:Venus'), '#o=body:Venus');
});

test('only proper ids make a link, and only proper links are read', () => {
  for (const bad of [null, undefined, '', 'sat', 'sat:', 'ship:1', 'sat:<script>', 'air:a/b', 'star:' + 'x'.repeat(60), 'body:Mars&x=1']) {
    assert.equal(K.validId(bad), false, String(bad));
    assert.equal(K.objectLink('viewer.html', bad), null, String(bad));
  }
  for (const bad of ['', '#', '#top', '#o=', '#o=sat', '#o=sat:%E0%A4%A', '#o=javascript:alert(1)', '#o=ship:3', null, undefined]) assert.equal(K.parseLink(bad), null, String(bad));
  assert.equal(K.parseLink('#x=1&o=sat:25544'), 'sat:25544', 'among other parts of the hash');
  assert.equal(K.parseLink('o=body:Moon'), 'body:Moon', 'with or without the #');
});

test('a link carries the object only, never a place', () => {
  const link = K.objectLink('viewer.html', 'air:4ca7b2');
  assert.doesNotMatch(link, /lat|lon|loc|\d+\.\d{3}/i);
  assert.match(read('lib/permalink.js'), /never carries a place/);
});

const ready = { loc: true, aircraft: true, sats: true };
test('what is said about an object that is not on the radar', () => {
  const below = K.missing('sat:25544', { unseen: { why: 'below', name: 'ISS (ZARYA)', el: -12.4, az: 40 }, dir: 'NE', ready });
  assert.equal(below.kind, 'below'); assert.equal(below.title, 'ISS (ZARYA) is below the horizon');
  assert.match(below.text, /12° below the horizon, toward the NE/);
  const far = K.missing('air:4ca7b2', { unseen: { why: 'far', name: 'EIN123', el: 2, az: 90, rangeKm: 310 }, rangeText: '310 km', ready });
  assert.equal(far.kind, 'far'); assert.match(far.text, /about 310 km away and low in the sky/);
  const gone = K.missing('air:4ca7b2', { ready });
  assert.equal(gone.kind, 'gone'); assert.equal(gone.title, 'Flight 4CA7B2 is not in your sky');
  assert.match(gone.text, /landed|out of range/);
  assert.equal(K.missing('sat:99999', { ready }).kind, 'gone');
  assert.equal(K.missing('met:Perseids', { ready }).kind, 'inactive');
});

test('while the place or the data is still arriving it says it is looking, not that the object is gone', () => {
  assert.equal(K.missing('air:4ca7b2', { ready: { loc: false } }).kind, 'wait');
  assert.equal(K.missing('air:4ca7b2', { ready: { loc: true, aircraft: false } }).kind, 'wait');
  assert.equal(K.missing('sat:25544', { ready: { loc: true, sats: false } }).kind, 'wait');
  assert.match(K.missing('sat:25544', { ready: { loc: true, sats: false } }).title, /^Looking for Satellite 25544/);
});

test('the page picks the linked object when it opens and when the address changes, and keeps the address in step with the pick', () => {
  const app = read('app.js'), v = read('viewer.html'), sw = read('sw.js');
  assert.match(app, /const first = window\.FarGemsLink && window\.FarGemsLink\.parseLink\(location\.hash\);\s*if \(first\) \{ state\.linkId = first; state\.sel = first; \}\s*bindUI\(\);/, 'picked before anything draws the card');
  assert.match(app, /window\.addEventListener\('hashchange', applyLink\);\s*renderAll\(\);/);
  assert.match(app, /state\.linkId = id; state\.sel = id; state\.passSel = null; state\.detailClosed = null;/);
  assert.match(app, /setPage\('radar'\)/);
  assert.match(app, /function renderDetail\(\) \{ renderDetailCard\(\); syncLink\(\); \}/, 'every change of the card updates the address');
  assert.match(app, /history\.replaceState\(history\.state, '', location\.pathname \+ location\.search \+ want\)/, 'replaced, so Back and the camera view are not disturbed');
  assert.match(app, /if \(!o && state\.sel && state\.sel === state\.linkId\) \{ put\(missingCard\(state\.sel\)\); return; \}[^\n]*\n\s*if \(!o\) \{ \/\/ nothing picked/, 'before the nearest flight is chosen instead');
  assert.match(app, /if \(o\.el < 0\) parts\.push\(/, 'an object under the horizon says so');
  assert.match(app, /Its layer is switched off/);
  assert.match(app, /state\.unseen = unseen/);
  assert.match(app, /url = objectUrl\(o\.id\)/, 'Share sends the link');
  assert.ok(v.indexOf('lib/permalink.js') > 0 && v.indexOf('lib/permalink.js') < v.indexOf('src="app.js"'), 'loaded before the app');
  assert.ok(sw.includes("'lib/permalink.js'"), 'available offline');
});
