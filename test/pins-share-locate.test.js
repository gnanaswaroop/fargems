'use strict';
// Pinned objects, sharing, the gear menu, names kept inside the radar, and a place from the network when none was shared.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../lib/logic.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const W = import('../worker/aircraft-proxy.mjs');

/* ---- pins ---- */
test('pins: parse safely, toggle, newest first, capped, and pinned objects lead the list', () => {
  assert.deepEqual(L.parsePins(null), []);
  assert.deepEqual(L.parsePins('not json'), []);
  assert.deepEqual(L.parsePins('{"a":1}'), []);
  assert.deepEqual(L.parsePins('["a",3,"","b"]'), ['a', 'b']);
  assert.deepEqual(L.togglePin([], 'body:Moon'), ['body:Moon']);
  assert.deepEqual(L.togglePin(['a', 'b'], 'c'), ['c', 'a', 'b'], 'the newest pin first');
  assert.deepEqual(L.togglePin(['a', 'b'], 'a'), ['b'], 'toggling again removes it');
  assert.equal(L.togglePin(Array.from({ length: 30 }, (_, i) => 'k' + i), 'new').length, 30, 'capped at 30');
  const items = [{ id: 'air:1' }, { id: 'sat:2' }, { id: 'star:3' }, { id: 'body:4' }];
  assert.deepEqual(L.pinFirst(items, ['body:4', 'sat:2']).map((o) => o.id), ['sat:2', 'body:4', 'air:1', 'star:3'], 'pinned first, the rest keep their order');
  assert.deepEqual(L.pinFirst(items, []).map((o) => o.id), items.map((o) => o.id));
});

test('the app pins from the card and from each row, keeps pins, and always names a pinned object on the radar', () => {
  const app = read('app.js'), css = read('style.css');
  assert.match(app, /state\.pins = L\.parsePins\(storedValue\('fg\.pins'\)\)/);
  assert.match(app, /localStorage\.setItem\('fg\.pins', JSON\.stringify\(state\.pins\)\)/);
  assert.match(app, /H\.pinFirst\(H\.sortNearest\(items\), state\.pins\)\.slice\(0, 60\)/, 'pinned objects lead the nearby list');
  assert.match(app, /<span class="nm">\$\{pinButton\(o\)\}/, 'a star in every row');
  assert.match(app, /aria-pressed="\$\{on\}" aria-label="\$\{on \? 'Unpin' : 'Pin'\}/);
  assert.match(app, /\$\{on \? '★ Pinned' : '☆ Pin'\}/, 'a labelled button in the detail card');
  assert.match(app, /prio: o\.id === sel \? 0 : pin \? 0\.5 :/, 'a pinned name is placed right after the selected one');
  assert.match(app, /\(pin \? '★ ' : ''\)/);
  assert.match(css, /\.pin\.on \{ color: var\(--body\); \}/);
});

/* ---- share ---- */
test('shareText says what and where to look, links the article, and says nothing about where the visitor is', () => {
  const moon = { id: 'body:Moon', kind: 'body', name: 'Moon', az: 68, el: 49.4 };
  const t = L.shareText(moon);
  assert.match(t, /^Moon \(moon\) is 49° above the horizon in the ENE \(68°\) right now\./);
  assert.match(t, /Read more: https:\/\/en\.wikipedia\.org\/wiki\/Moon$/);
  const flight = { id: 'air:a1', kind: 'air', name: 'AIC144', az: 200, el: 31, ac: { type: 'A20N' } };
  assert.match(L.shareText(flight, 'Flying to Delhi.'), /AIC144 \(aircraft\) is 31° above the horizon in the SSW \(200°\) right now\. Flying to Delhi\. Read more: .*Airbus_A320neo_family$/);
  assert.equal(L.shareText({ id: 'sat:9', kind: 'sat', name: 'COSMOS 1 DEB', az: 10, el: 5 }), 'COSMOS 1 DEB (satellite) is 5° above the horizon in the N (10°) right now.', 'no article, no link');
  assert.equal(L.shareText(null), '');
  assert.doesNotMatch(t, /\d+\.\d{3}/, 'no coordinates');
});

test('the app shares through the phone share sheet, or copies the text', () => {
  const app = read('app.js');
  assert.match(app, /navigator\.share\) \{ await navigator\.share\(\{ title: o\.name \+ ' in the sky', text, url \}\)/);
  assert.match(app, /navigator\.clipboard\.writeText\(text \+ ' ' \+ url\)/);
  assert.match(app, /e\.name !== 'AbortError'/, 'closing the share sheet is not an error');
  assert.match(app, /data-share="\$\{esc\(o\.id\)\}">Share</);
  assert.match(app, /url = objectUrl\(o\.id\)/, 'the link is the permalink of this object');
  assert.match(app, /location\.origin \+ location\.pathname\.replace\(\/\[\^\/\]\*\$\/, ''\) \+ 'viewer\.html'/, 'on this site, taken from where it is served');
});

/* ---- gear menu ---- */
test('the viewer header has a gear that opens Settings and Help; Help is also in the home menu', () => {
  const v = read('viewer.html'), idx = read('index.html'), about = read('about.html');
  assert.doesNotMatch(v, /<a class="pill" href="settings\.html">Settings<\/a>/, 'the text link is gone');
  assert.match(v, /<button id="gearBtn" class="menu-btn gear"[^>]*aria-label="Settings and help"[^>]*aria-expanded="false"[^>]*aria-controls="gearList"><svg/);
  const list = v.match(/<ul id="gearList" class="menu-list" hidden>([\s\S]*?)<\/ul>/)[1];
  assert.match(list, /<a href="settings\.html">Settings<\/a>/);
  assert.match(list, /<a href="about\.html">About &amp; help<\/a>/);
  assert.match(idx.match(/<ul id="menuList"[\s\S]*?<\/ul>/)[0], /<a href="about\.html">About &amp; help<\/a>/);
  assert.match(about, /<h3 id="faq">/, 'the questions are on the About page, so one entry covers both');
  const app = read('app.js');
  assert.match(app, /gear\.addEventListener\('click'/);
  assert.match(app, /e\.key === 'Escape' && !gearList\.hidden/);
});

/* ---- names stay inside the radar ---- */
test('shortLabel cuts a long name; the radar keeps every name inside the canvas (it may cross the horizon circle)', () => {
  assert.equal(L.shortLabel('Vega'), 'Vega');
  assert.equal(L.shortLabel('Southern Delta Aquariids'), 'Southern Delta Aqua…');
  assert.equal(L.shortLabel('Southern Delta Aquariids').length, 20);
  assert.equal(L.shortLabel(null), '');
  const app = read('app.js');
  assert.doesNotMatch(app, /Math\.hypot\(x - cx, y - cy\) <= R - 1/, 'a name may go outside the horizon circle');
  assert.match(app, /fits\(r\) && !overlaps\(r\)/, 'but not off the canvas');
  assert.match(app, /pick\.x \+= \(cx - pick\.x\) \* 0\.08/, 'an important name that has no free spot is moved toward the middle');
  assert.match(app, /o\.id === sel \? o\.name : L\.shortLabel\(o\.name\)/, 'the selected object keeps its full name');
});

/* ---- a place from the network ---- */
test('locate: the address comes from the aircraft address, and only a real place is accepted', () => {
  assert.equal(L.locateProxyUrl('https://relay.example/aircraft'), 'https://relay.example/locate');
  assert.equal(L.locateProxyUrl('https://relay.example/aircraft?key=1'), 'https://relay.example/locate');
  assert.equal(L.locateProxyUrl('https://relay.example/v1/aircraft/'), 'https://relay.example/v1/locate');
  assert.equal(L.locateProxyUrl(''), null);
  assert.equal(L.locateProxyUrl(undefined), null);
  assert.equal(L.locateProxyUrl('relay.example/aircraft'), null);
  assert.deepEqual(L.parseIpLocation({ lat: 17.38, lon: 78.48, city: 'Hyderabad', region: 'Telangana', country: 'IN' }), { lat: 17.38, lon: 78.48, label: 'Hyderabad, IN' });
  assert.deepEqual(L.parseIpLocation({ lat: '12.97', lon: '77.59', city: '', country: 'IN' }), { lat: 12.97, lon: 77.59, label: 'IN' });
  for (const bad of [null, {}, { lat: 'x', lon: 1 }, { lat: 91, lon: 0 }, { lat: 0, lon: 181 }, { lat: null, lon: null }, 'text']) assert.equal(L.parseIpLocation(bad), null, JSON.stringify(bad));
});

test('worker /locate: the city from Cloudflare, rounded, never cached, 404 when unknown, same origin rules', async () => {
  const { handle } = await W;
  const env = { ALLOWED_ORIGINS: 'https://fargems.example' };
  const req = (cf, origin = 'https://fargems.example') => Object.assign(new Request('https://relay.example/locate', { headers: origin ? { Origin: origin } : {} }), { cf });
  const res = await handle(req({ latitude: '17.38405', longitude: '78.45636', city: 'Hyderabad', region: 'Telangana', country: 'IN' }), env, { fetchImpl: () => { throw new Error('no provider is called'); }, cache: { match: () => { throw new Error('no cache read'); }, put: () => { throw new Error('no cache write'); } } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { lat: 17.38, lon: 78.46, city: 'Hyderabad', region: 'Telangana', country: 'IN' }, 'rounded to about a kilometre');
  assert.equal(res.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://fargems.example');
  const none = await handle(req(undefined), env, { cache: {} });
  assert.equal(none.status, 404);
  assert.equal(none.headers.get('Cache-Control'), 'private, no-store');
  const other = await handle(req({ latitude: 1, longitude: 2 }, 'https://evil.example'), env, { cache: {} });
  assert.equal(other.headers.get('Access-Control-Allow-Origin'), null, 'a site that is not allowed gets no CORS header');
  const src = read('worker/aircraft-proxy.mjs');
  assert.doesNotMatch(src.match(/function handleLocate[\s\S]*?\n\}/)[0], /cache\.|caches|console\./, 'nothing stored or logged');
});

test('the viewer uses the network guess only when no location exists, says so, and does not save it', () => {
  const app = read('app.js'), v = read('viewer.html');
  assert.match(app, /else locateWithoutPermission\(\);/);
  assert.match(app, /p\.state === 'granted'/, 'the exact location is used first when the browser already allows it');
  assert.match(app, /locateProxyUrl\(AIRCRAFT_PROXY\)/);
  assert.match(app, /if \(place && !state\.loc\) setLoc\(place\.lat, place\.lon, place\.label \|\| 'your area'\)/);
  assert.match(app, /if \(state\.approx == null\) lsSet\('fg\.loc', state\.loc\)/, 'a guess is not remembered as the visitor\'s location');
  assert.match(v, /<p id="approxNote" class="approx" hidden><\/p>/);
  assert.match(app, /a guess from your network/);
  assert.match(app, /'Use your exact location'/);
});

test('About tells visitors about the network guess', () => {
  const t = read('about.html').replace(/<[^>]+>/g, ' ');
  assert.match(t, /without sharing a location[\s\S]*Cloudflare[\s\S]*city/);
  assert.match(t, /does not collect your location/);
});

test('even the selected object\'s full name is cut to fit across the radar', () => {
  const app = read('app.js');
  assert.match(app, /const maxW = Math\.min\(W \* 0\.6, R \* 1\.3\);/);
  assert.match(app, /while \(ctx\.measureText\(L\.text\)\.width > maxW && L\.text\.length > 4\)/);
  assert.match(app, /pick = \{ x: spots\[0\]\.x, y: spots\[0\]\.y, a: 'center' \};/);
});

test('the browser tests can reach the page state only when asked with ?fgtest=1', () => {
  assert.match(read('app.js'), /if \(\/\[\?&\]fgtest=1\\b\/\.test\(location\.search\)\) window\.__fg = \{ state, draw, renderNearby, renderDetail, renderPasses, closeDetail, pathFor, settleCourses, arView: \(\) => arView \};/);
});
