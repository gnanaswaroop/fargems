'use strict';
// Station passes you can tap, and a key to the radar symbols.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../lib/logic.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('untilText says how long until a pass starts', () => {
  assert.equal(L.untilText(-5000), 'now');
  assert.equal(L.untilText(20000), 'now');
  assert.equal(L.untilText(25 * 60000), 'in 25 min');
  assert.equal(L.untilText(89 * 60000), 'in 89 min');
  assert.equal(L.untilText(95 * 60000), 'in 1 h 35 min');
  assert.equal(L.untilText(180 * 60000), 'in 3 h');
  assert.equal(L.untilText(40 * 3600000), 'in 40 h');
  assert.equal(L.untilText(3 * 86400000), 'in 3 days');
  assert.equal(L.untilText(NaN), '');
});

test('each station pass is a button that chooses the pass, draws its path and shows a card', () => {
  const app = read('app.js'), css = read('style.css');
  assert.match(app, /<button type=\\"button\\" class=\\"pass|<button type="button" class="pass/);
  assert.match(app, /data-pass="\$\{i\}" aria-pressed="\$\{on\}"/);
  assert.match(app, /\$\('#passes'\)\.addEventListener\('click', \(e\) => \{ const b = e\.target\.closest\('\[data-pass\]'\); if \(b\) choosePass\(Number\(b\.dataset\.pass\)\); \}\);/);
  assert.match(app, /id: 'sat:' \+ s\.norad, satName: s\.name, \.\.\.p, path: passPath\(s\.rec, p\)/);
  assert.match(app, /if \(ps && !state\.byId\.has\(ps\.id\) && \(!state\.sel \|\| state\.sel === ps\.id\)\) \{ put\(passCard\(ps\)\); return; \}/);
  assert.match(app, /ctx\.setLineDash\(\[6, 5\]\)/, 'a dashed path on the radar');
  assert.match(app, /state\.sel = state\.byId\.has\(p\.id\) \? p\.id : null/, 'a station that is up is selected');
  assert.match(css, /\.pass\.on, \.pass:hover, \.pass:focus-visible/);
  assert.match(app, /maxAz: la\.az/, 'where the pass peaks is kept');
});

test('both stations are in the list: the ISS and Tiangong', () => {
  const app = read('app.js');
  assert.match(app, /for \(const re of \[\/\^ISS \\\(ZARYA\\\)\/, \/\^CSS \\\(TIANHE\\\)\/\]\)/);
  assert.match(app, /name: re\.source\.includes\('ISS'\) \? 'ISS' : 'Tiangong'/);
  assert.equal(L.wikiTitle({ kind: 'sat', name: 'ISS (ZARYA)' }), 'International Space Station');
  assert.equal(L.wikiTitle({ kind: 'sat', name: 'CSS (TIANHE)' }), 'Tiangong space station');
});

test('the key explains the radar: centre and edge, every symbol, and the meteor shower plus', () => {
  const v = read('viewer.html');
  const legend = v.match(/<details id="legend" class="card legend">([\s\S]*?)<\/details>/)[1];
  assert.match(legend, /<summary>What do the symbols mean\?<\/summary>/);
  const text = legend.replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&#x[0-9A-F]+;/gi, ' ').replace(/\s+/g, ' ');
  for (const w of ['middle of the radar is straight above you', 'edge is the horizon', '30° and 60°', 'Aircraft', 'Satellite', 'space station', 'The Sun', 'The Moon', 'A planet', 'A bright star', 'Leonids', 'radiant', 'the object you picked', 'dashed line']) assert.ok(text.includes(w), w);
  assert.equal((legend.match(/<li>/g) || []).length, 10);
  assert.ok(!/<details id="legend"[^>]*\bopen\b/.test(v), 'closed until asked');
  // Every picture in the key is decoration: the words carry the meaning.
  assert.ok((legend.match(/class="sym[^"]*" aria-hidden="true"/g) || []).length === 10);
  assert.ok(v.indexOf('id="passes"') < v.indexOf('id="legend"'), 'the key comes after the details and passes');
});
