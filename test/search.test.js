'use strict';
// Searching the sky for an object by name, and picking it as the selected object.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../lib/search.js');
const L = require('../lib/logic.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const objs = [
  { id: 'air:a1', kind: 'air', name: 'AIC144', ac: { call: 'AIC144', reg: 'VT-ANA', type: 'B77W', id: 'a1' }, el: 31, az: 200, range: 12 },
  { id: 'air:a2', kind: 'air', name: 'IGO6E21', ac: { call: 'IGO6E21', reg: 'VT-IXA', type: 'A20N', id: 'a2' }, el: 12, az: 20, range: 40 },
  { id: 'air:a3', kind: 'air', name: 'AIC301', ac: { call: 'AIC301', reg: '', type: 'A321', id: 'a3' }, el: 50, az: 100, range: 6 },
  { id: 'sat:25544', kind: 'sat', name: 'ISS (ZARYA)', norad: 25544, el: 40, az: 90, range: 400 },
  { id: 'sat:44713', kind: 'sat', name: 'STARLINK-1007', norad: 44713, el: 62, az: 300, range: 700 },
  { id: 'sat:44714', kind: 'sat', name: 'STARLINK-1008', norad: 44714, el: 20, az: 310, range: 1100 },
  { id: 'body:Sun', kind: 'body', name: 'Sun', el: -20, az: 300 },
  { id: 'body:Moon', kind: 'body', name: 'Moon', el: 49, az: 68 },
  { id: 'body:Mars', kind: 'body', name: 'Mars', el: 20, az: 10 },
  { id: 'body:Venus', kind: 'body', name: 'Venus', el: 8, az: 250 },
  { id: 'star:Vega', kind: 'star', name: 'Vega', el: 60, az: 10 },
  { id: 'star:Alpha Centauri', kind: 'star', name: 'Alpha Centauri', el: 5, az: 180 },
  { id: 'met:Perseids', kind: 'met', name: 'Perseids', el: 30, az: 40 },
];
const unseen = new Map([['sat:48274', { why: 'below', name: 'CSS (TIANHE)', el: -20, az: 45 }], ['air:zz1', { why: 'far', name: 'QTR8', el: 3, az: 1, rangeKm: 300 }]]);
const find = (q, extra) => S.search(q, { objs, unseen }, Object.assign({ airlineOf: L.airlineOf }, extra));
const ids = (q, extra) => find(q, extra).map((r) => r.id);

test('a name, part of a name, a flight number, a registration, an aircraft type or a catalogue number finds the object', () => {
  assert.deepEqual(ids('iss'), ['sat:25544']);
  assert.deepEqual(ids('ISS (ZARYA)'), ['sat:25544'], 'the whole name, brackets and all');
  assert.deepEqual(ids('zarya'), ['sat:25544'], 'a word in the middle');
  assert.deepEqual(ids('25544'), ['sat:25544'], 'the catalogue number of a satellite');
  assert.deepEqual(ids('moon'), ['body:Moon']); assert.deepEqual(ids('moo'), ['body:Moon']);
  assert.deepEqual(ids('vega'), ['star:Vega']);
  assert.deepEqual(ids('alpha cent'), ['star:Alpha Centauri'], 'two words, the second only begun');
  assert.deepEqual(ids('igo6e21'), ['air:a2'], 'a flight number');
  assert.deepEqual(ids('vt-ana'), ['air:a1'], 'a registration, with its dash');
  assert.deepEqual(ids('vtana'), ['air:a1'], 'or without');
  assert.deepEqual(ids('b77w'), ['air:a1'], 'an aircraft type');
  assert.deepEqual(ids('perseid'), ['met:Perseids']);
});

test('an airline name finds its flights, nearest first', () => {
  assert.deepEqual(ids('air india'), ['air:a3', 'air:a1'], 'both Air India flights, the nearer one first');
  assert.deepEqual(ids('indigo'), ['air:a2']);
  assert.deepEqual(find('air india', { airlineOf: undefined }), [], 'with no airline lookup it is not guessed');
});

test('case, spaces and punctuation do not matter, and an empty or odd query finds nothing', () => {
  assert.deepEqual(ids('  MOON  '), ['body:Moon']); assert.deepEqual(ids('iss zarya'), ['sat:25544']);
  for (const q of ['', '   ', '??', 'zzzz', 'moonn', null, undefined]) assert.deepEqual(ids(q), [], JSON.stringify(q));
  assert.deepEqual(S.search('moon', null), []); assert.deepEqual(S.search('moon', {}), []);
  assert.deepEqual(S.search('moon', { objs: [null, { id: 'x' }, { name: 'Moon' }, { id: 'body:Moon', name: 'Moon' }] }).map((r) => r.id), ['body:Moon'], 'bad entries are skipped');
});

test('a kind of object by its word lists some of them, with the name matches first', () => {
  assert.deepEqual(new Set(ids('planets')), new Set(['body:Mars', 'body:Venus']), 'the Sun and the Moon are not planets');
  assert.deepEqual(new Set(ids('satellite')), new Set(['sat:25544', 'sat:44713', 'sat:44714', 'sat:48274']), 'including one that is below the horizon');
  assert.deepEqual(new Set(ids('stars')), new Set(['star:Vega', 'star:Alpha Centauri']));
  assert.deepEqual(new Set(ids('meteor')), new Set(['met:Perseids']));
  assert.deepEqual(new Set(ids('flights')), new Set(['air:a1', 'air:a2', 'air:a3', 'air:zz1']));
  assert.deepEqual(ids('star').slice(0, 2).sort(), ['star:Alpha Centauri', 'star:Vega'], 'the word for a kind brings that kind first, ahead of names that merely begin with it (Starlink)');
  assert.ok(ids('star').includes('sat:44713'), 'and the others that match the name follow');
});

test('better matches come first: exact, then starts with, then a word starts with, then contains', () => {
  const o = [{ id: 'a:1', kind: 'star', name: 'Rigel Kentaurus' }, { id: 'a:2', kind: 'star', name: 'Rigel' }, { id: 'a:3', kind: 'star', name: 'Capella Rigelian' }, { id: 'a:4', kind: 'star', name: 'Trigel' }];
  assert.deepEqual(S.search('rigel', { objs: o }).map((r) => r.id), ['a:2', 'a:1', 'a:3', 'a:4']);
});

test('what is up now comes before what is not, among equal matches, and nearer comes before further', () => {
  const r = find('starlink');
  assert.deepEqual(r.map((x) => x.id), ['sat:44713', 'sat:44714'], 'nearer first');
  const mixed = S.search('tia', { objs: [{ id: 'sat:1', kind: 'sat', name: 'TIANHE-1', el: 10, az: 1, range: 900 }], unseen: new Map([['sat:2', { why: 'below', name: 'TIANHE-2', el: -5, az: 2 }]]) });
  assert.deepEqual(mixed.map((x) => x.id), ['sat:1', 'sat:2'], 'up now first');
});

test('an object that is not up is found too, and says why it is not on the radar', () => {
  const t = find('tianhe')[0];
  assert.equal(t.id, 'sat:48274'); assert.equal(t.up, false); assert.equal(t.why, 'below');
  const q = find('qtr')[0];
  assert.equal(q.id, 'air:zz1'); assert.equal(q.why, 'far'); assert.equal(q.kind, 'air');
  assert.equal(find('48274')[0].id, 'sat:48274', 'by catalogue number too');
  assert.equal(find('iss')[0].up, true); assert.equal(find('iss')[0].why, null);
  assert.deepEqual(S.search('qtr', { objs: [], unseen: [['air:zz1', { why: 'far', name: 'QTR8' }]] }).map((x) => x.id), ['air:zz1'], 'a list of pairs works as well as a Map');
});

test('at most the limit is returned (8 by default), and a result carries what the list needs', () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ id: 'sat:' + (1000 + i), kind: 'sat', name: 'STARLINK-' + i, el: 10 + i, az: 1, range: 500 + i }));
  assert.equal(S.search('starlink', { objs: many }).length, 8);
  assert.equal(S.search('starlink', { objs: many }, { limit: 3 }).length, 3);
  assert.deepEqual(Object.keys(find('aic144')[0]).sort(), ['az', 'detail', 'el', 'id', 'kind', 'name', 'range', 's', 'up', 'why']);
  assert.equal(find('aic144')[0].detail, 'B77W', 'the aircraft type is shown beside a flight');
  assert.equal(find('moon')[0].detail, '');
});

test('the search is quick enough for thousands of satellites', () => {
  const big = Array.from({ length: 6000 }, (_, i) => ({ id: 'sat:' + i, kind: 'sat', name: 'STARLINK-' + i, norad: i, el: 5, az: 1, range: i }));
  const t0 = Date.now(); S.search('starlink 59', { objs: big }); S.search('zzz', { objs: big });
  assert.ok(Date.now() - t0 < 400, 'took ' + (Date.now() - t0) + ' ms');
});

/* ---- the page ---- */
test('the page has a search box above both views, loads the search code and keeps it offline', () => {
  const v = read('viewer.html'), sw = read('sw.js');
  assert.match(v, /<div id="searchbar" class="searchbar" role="search">\s*<label class="sr-only" for="searchBox">Search the sky<\/label>\s*<input id="searchBox" type="search"/);
  assert.match(v, /role="combobox" aria-expanded="false" aria-controls="searchResults" aria-autocomplete="list"/);
  assert.match(v, /<ul id="searchResults" class="search-results" role="listbox" aria-label="Search results" hidden><\/ul>/);
  assert.ok(v.indexOf('id="searchbar"') > v.indexOf('role="tablist"') && v.indexOf('id="searchbar"') < v.indexOf('class="pager-view"'), 'between the tabs and the two views');
  assert.ok(v.indexOf('lib/search.js') < v.indexOf('src="app.js"'), 'loads before the app');
  assert.match(sw, /'lib\/search\.js'/);
});

test('picking a result selects the object like a tap does, and every view follows', () => {
  const app = read('app.js');
  const fn = app.slice(app.indexOf('function pickFromSearch'), app.indexOf('function searchWhere'));
  assert.match(fn, /state\.linkId = id; state\.sel = id; state\.passSel = null; state\.detailClosed = null; state\.dirty = true;/, 'the same as opening a link to it, so one that is not up gets an explaining card');
  assert.match(fn, /renderDetail\(\); renderNearby\(\); renderPasses\(\); setPage\('radar'\);/, 'the card, the Nearby list and the passes follow, and the radar is shown');
  // the result rows must not use a class name that something else on the page already styles (an older ".sr" hides things from sight)
  assert.match(app, /class="srch\$\{r\.up/);
  assert.doesNotMatch(app, /class="sr[ "$]/);
  const css = read('style.css');
  assert.ok(/^\.sr\{position:absolute;width:1px/m.test(css),'the screen-reader-only rule is still there, so the row class must differ from it');
  assert.match(app, /bindUI\(\) \{\r?\n  bindSearch\(\);/);
  assert.match(app, /const choose = \(id\) => \{ if \(!id\) return; box\.value = ''; close\(\); pickFromSearch\(id\); box\.blur\(\); \};/);
  assert.match(app, /e\.key === 'Enter'/); assert.match(app, /e\.key === 'Escape'/); assert.match(app, /e\.key === 'ArrowDown' \|\| e\.key === 'ArrowUp'/);
  assert.match(app, /if \(e\.key !== '\/' \|\| e\.ctrlKey/, 'the slash key jumps to the box');
  assert.doesNotMatch(read('lib/search.js'), /fetch\(|localStorage|document\./, 'the search code only looks at what it is given');
});
