'use strict';
// The viewer is only as tall as the page being looked at; the detail card is short and defaults to the nearest flight or
// satellite; every object that has a Wikipedia article links to it, in the detail card and in the nearby list.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../lib/logic.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('wikiTitle: planets, Sun, Moon, stars, meteor showers, stations, constellations and aircraft types', () => {
  const t = (o) => L.wikiTitle(o);
  assert.equal(t({ kind: 'body', name: 'Sun' }), 'Sun');
  assert.equal(t({ kind: 'body', name: 'Moon' }), 'Moon');
  assert.equal(t({ kind: 'body', name: 'Mercury' }), 'Mercury (planet)', 'not the element');
  assert.equal(t({ kind: 'body', name: 'Saturn' }), 'Saturn');
  assert.equal(t({ kind: 'star', name: 'Vega' }), 'Vega');
  assert.equal(t({ kind: 'star', name: 'Pollux' }), 'Pollux (star)', 'not the disambiguation page');
  assert.equal(t({ kind: 'met', name: 'Perseids' }), 'Perseids');
  assert.equal(t({ kind: 'sat', name: 'ISS (ZARYA)' }), 'International Space Station');
  assert.equal(t({ kind: 'sat', name: 'CSS (TIANHE)' }), 'Tiangong space station');
  assert.equal(t({ kind: 'sat', name: 'STARLINK-1234' }), 'Starlink');
  assert.equal(t({ kind: 'sat', name: 'HST' }), 'Hubble Space Telescope');
  assert.equal(t({ kind: 'sat', name: 'COSMOS 2251 DEB' }), null, 'no guessing for an unknown satellite');
  assert.equal(t({ kind: 'air', name: 'UAL1', ac: { type: 'b738' } }), 'Boeing 737 Next Generation');
  assert.equal(t({ kind: 'air', name: 'AIC144', ac: { type: 'A20N' } }), 'Airbus A320neo family');
  assert.equal(t({ kind: 'air', name: 'X', ac: { type: 'ZZZZ' } }), null);
  assert.equal(t({ kind: 'air', name: 'X', ac: {} }), null);
  assert.equal(t(null), null);
});

test('every star and meteor shower the app draws has an article title, and Wikipedia addresses are well formed', () => {
  const app = read('app.js');
  const stars = [...app.match(/const STARS = \[([\s\S]*?)\];/)[1].matchAll(/\['([^']+)'/g)].map((m) => m[1]);
  assert.ok(stars.length >= 19);
  for (const n of stars) assert.ok(L.wikiTitle({ kind: 'star', name: n }), `a page for ${n}`);
  const showers = [...app.match(/const SHOWERS = \[([\s\S]*?)\n\];/)[1].matchAll(/n: '([^']+)'/g)].map((m) => m[1]);
  assert.ok(showers.length >= 10);
  for (const n of showers) assert.equal(L.wikiTitle({ kind: 'met', name: n }), n);
  assert.equal(L.wikiUrl('Mercury (planet)'), 'https://en.wikipedia.org/wiki/Mercury_(planet)');
  assert.equal(L.wikiUrl('Boeing 737 Next Generation'), 'https://en.wikipedia.org/wiki/Boeing_737_Next_Generation');
  assert.equal(L.wikiUrl(null), null);
  assert.equal(L.wikiSummaryUrl('Tiangong space station'), 'https://en.wikipedia.org/api/rest_v1/page/summary/Tiangong_space_station');
});

test('wikiBlurb keeps the opening of an article short and ends it cleanly', () => {
  assert.equal(L.wikiBlurb('Short text.'), 'Short text.');
  const long = 'Vega is the brightest star in Lyra. It is relatively close to the Sun, at only 25 light-years. ' + 'More words that go on and on. '.repeat(20);
  const b = L.wikiBlurb(long, 120);
  assert.ok(b.length <= 121 && b.endsWith('.'), b);
  assert.ok(L.wikiBlurb('x '.repeat(400), 100).endsWith('…'));
  assert.equal(L.wikiBlurb(null), '');
});

test('the detail card links to Wikipedia, shows the opening when it arrives, and drops the link if there is no article', () => {
  const app = read('app.js');
  assert.match(app, /const wt = H\.wikiTitle\(o\), wk = wt && wikiInfo\(wt\);/);
  assert.match(app, /class="wiki" href="\$\{H\.wikiUrl\(wt\)\}" target="_blank" rel="noopener">Read about/);
  assert.match(app, /wikiSummaryUrl\(title\)/);
  assert.match(app, /j\.type === 'standard' \? \{ extract: j\.extract \} : \{ miss: true \}/, 'a disambiguation page is not shown');
  assert.match(app, /e\.message === 'missing'\) entry\.info = \{ miss: true \}; else wikiCache\.delete\(title\)/, 'offline is retried, a missing article is final');
  assert.match(app, /wikiBlurb\(wk\.extract\)/);
  assert.match(app, /setHtml\(\$\('#arDetail'\)/, 'the camera view gets the link too');
});

test('nearby rows link to Wikipedia without turning the link into a tap on the row', () => {
  const app = read('app.js');
  assert.match(app, /\$\{wikiTitle\(o\) \? ` <a class="wiki" href="\$\{H\.wikiUrl\(wikiTitle\(o\)\)\}" target="_blank" rel="noopener"/);
  assert.match(app, /e\.target\.closest\('a'\)/);
  assert.match(read('style.css'), /\.nearby-row \.wiki \{/);
});

test('the detail card is short, and defaults to the nearest flight or satellite', () => {
  const app = read('app.js');
  assert.match(app, /H\.sortNearest\(state\.objs\.filter\(x => \(x\.kind === 'air' \|\| x\.kind === 'sat'\) && x\.el >= 0\)\)\[0\]/);
  assert.match(app, /Nearest \$\{o\.kind === 'air' \? 'flight' : 'satellite'\}/);
  const air = app.match(/if \(o\.kind === 'air'\) \{([\s\S]*?)\} else if \(o\.kind === 'sat'\)/)[1];
  assert.equal((air.match(/kv\('/g) || []).length, 5, 'a flight shows where it flies to, altitude, speed, distance and a tracking link, plus its sky position');
  for (const gone of ['Registration', 'ICAO hex', "kv('Heading'", "kv('Vertical'"]) assert.ok(!air.includes(gone), `${gone} is gone from the card`);
  const sat = app.match(/else if \(o\.kind === 'sat'\) \{([\s\S]*?)\} else if \(o\.kind === 'body'\)/)[1];
  assert.ok(!sat.includes('NORAD ID') && !sat.includes("'Speed'"));
});

test('the viewer is only as tall as the page being looked at, with no long empty scroll', () => {
  const css = read('style.css');
  assert.match(css, /\.pager:not\(\.nearby\) #pageNearby, \.pager\.nearby #pageRadar \{ max-height: 0; overflow: hidden; visibility: hidden; \}/);
  const wide = css.match(/@media \(min-width: 900px\) and \(min-aspect-ratio: 5\/4\) \{([\s\S]*)\n\}\s*$/)[1];
  assert.match(wide, /body\.viewer \.pager\.nearby #pageRadar \{ max-height: none; visibility: visible; \}/, 'on a wide screen the radar is shown whichever tab was last used');
});
