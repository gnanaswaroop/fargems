'use strict';
// The picture at the top of the detail card: drawn for the Sun, Moon and planets, the photo of the type for flights and satellites.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../lib/preview.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const body = (name, extra) => ({ kind: 'body', name, color: '#cfd6e4', ...extra });

test('the Sun, the Moon and every planet have a drawing, and nothing else does', () => {
  for (const n of ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune']) {
    const s = P.bodyArt(body(n, { phase: 0.5, waxing: true }));
    assert.match(s, /^<svg viewBox="0 0 100 100" role="img" aria-label="[^"]+"/, n);
    assert.doesNotMatch(s, /<script|onload|javascript:|https?:/i, n + ': nothing active, nothing from another site');
  }
  assert.equal(P.bodyArt({ kind: 'air', name: 'AI101' }), null);
  assert.equal(P.bodyArt({ kind: 'star', name: 'Sirius' }), null);
  assert.equal(P.bodyArt(null), null);
});

test('the Moon is a real photograph of it, with tonight\'s shadow laid over: new is covered, full is bare, and the lit side follows waxing and waning', () => {
  assert.equal(P.MOON_IMAGE, 'assets/moon-full.jpg');
  assert.ok(fs.existsSync(path.join(__dirname, '..', P.MOON_IMAGE)), 'the photo is in the app');
  assert.ok(fs.statSync(path.join(__dirname, '..', P.MOON_IMAGE)).size < 80 * 1024, 'and is small');
  for (const k of [0, 0.25, 0.5, 0.75, 1]) assert.match(P.moonArt(k, true), /<image href="assets\/moon-full\.jpg"/, 'the photo under every phase: ' + k);
  assert.doesNotMatch(P.moonArt(1, true), /fill-rule/, 'full Moon: no shadow');
  const nu = P.moonArt(0, true);
  assert.match(nu, /fill-rule="evenodd"/); assert.doesNotMatch(nu, / A\d+ 40 0 0 [01] 0 -40 Z/, 'new Moon: all shadow, no lit part cut out');
  const wax = P.moonArt(0.25, true), wane = P.moonArt(0.25, false);
  assert.match(wax, /scale\(1 1\)/); assert.match(wane, /scale\(-1 1\)/, 'waning is lit on the other side');
  assert.doesNotMatch(wax, /rotate\(180\)/);
  assert.match(P.moonArt(0.25, true, true), /rotate\(180\)/, 'seen from the south the Moon is upside down');
  assert.match(P.moonArt(0.25, true), /A20 40 0 0 0 0 -40 Z/, 'a crescent: the edge bows toward the lit side');
  assert.match(P.moonArt(0.75, true), /A20 40 0 0 1 0 -40 Z/, 'gibbous: the edge bows the other way');
  assert.match(P.moonArt(0.5, true), /A0 40 /, 'half: a straight edge');
  assert.match(P.moonArt(0.3, true), /aria-label="The Moon tonight, 30% lit"/, 'said in words as well');
  assert.match(P.moonArt(NaN, true), /0% lit/, 'a missing value is a new Moon, not a broken picture');
  assert.match(P.bodyArt(body('Moon', { phase: 0.5 })), /scale\(1 1\)/, 'no side known: drawn waxing');
});


test('Saturn has rings, Jupiter has bands, the colour of a planet is the one on the radar and a bad colour is not used', () => {
  assert.match(P.bodyArt(body('Saturn')), /Saturn with its rings/);
  assert.match(P.bodyArt(body('Jupiter')), /rect/);
  assert.doesNotMatch(P.bodyArt(body('Mars')), /rect x="-40"/);
  assert.match(P.bodyArt(body('Mars', { color: '#e07a5f' })), /stop-color="#e07a5f"/);
  const evil = P.bodyArt(body('Venus', { color: '"><script>alert(1)</script>' }));
  assert.doesNotMatch(evil, /script/); assert.match(evil, /stop-color="#cfd6e4"/);
});

test('the same drawing twice in a page gets names of its own, so both copies show', () => {
  const a = P.bodyArt(body('Moon', { phase: 0.4 }), { uid: 'a' }), b = P.bodyArt(body('Moon', { phase: 0.4 }), { uid: 'b' });
  assert.match(a, /id="pvMoonDisca"/); assert.match(a, /url\(#pvMoonDisca\)/); assert.match(b, /id="pvMoonDiscb"/);
  assert.doesNotMatch(a, /pvMoonDiscb/);
  assert.equal([...a.matchAll(/id="(pv\w+)"/g)].every((m) => a.includes('#' + m[1] + ')')), true, 'every name is used');
});

test('which objects get a drawing, which a photo, and which none', () => {
  assert.equal(P.photoKind(body('Mars')), 'art'); assert.equal(P.photoKind(body('Sun')), 'art');
  assert.equal(P.photoKind({ kind: 'air' }), 'photo'); assert.equal(P.photoKind({ kind: 'sat' }), 'photo');
  assert.equal(P.photoKind({ kind: 'star' }), null); assert.equal(P.photoKind({ kind: 'met' }), null); assert.equal(P.photoKind(null), null);
});

test('only a picture from Wikimedia over https is taken from a Wikipedia answer', () => {
  const u = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/3/3c/Cathay_Pacific_Boeing_777-200%3B_B-HNL%40HKG.jpg/330px-Cathay_Pacific_Boeing_777-200%3B_B-HNL%40HKG.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail';
  const up = 'https://upload.wikimedia.org/wikipedia/commons/a/a1/Boeing_777.jpg';
  assert.equal(P.photoOf({ thumbnail: { source: up } }), up, 'the other Wikimedia picture host');
  assert.equal(P.photoOf({ type: 'standard', thumbnail: { source: u, width: 320, height: 213 } }), u);
  assert.equal(P.photoOf({ type: 'standard' }), null, 'an article with no picture');
  assert.equal(P.photoOf({ thumbnail: { source: 'http://upload.wikimedia.org/x.jpg' } }), null, 'not over plain http');
  assert.equal(P.photoOf({ thumbnail: { source: 'https://example.com/x.jpg' } }), null, 'not from another site');
  assert.equal(P.photoOf({ thumbnail: { source: 'javascript:alert(1)' } }), null);
  assert.equal(P.photoOf(null), null); assert.equal(P.photoOf({ thumbnail: { source: 5 } }), null);
});

test('the page loads the preview code, the app keeps it offline, and a photo that fails to load goes away', () => {
  assert.match(read('viewer.html'), /<script defer src="lib\/preview\.js"><\/script>/);
  assert.match(read('sw.js'), /'lib\/preview\.js'/);
  const app = read('app.js');
  assert.match(app, /thumb: window\.FarGemsPreview \? window\.FarGemsPreview\.photoOf\(j\) : null/, 'the thumbnail is kept with the article text');
  assert.match(app, /\$\{previewHtml\(o, wt, wk, uid\)\}<div class="hdt"><h3>/, 'the picture is in the head of the card, beside the name');
  assert.match(app, /\$\{head\('a'\)\}/); assert.match(app, /\$\{head\('b'\)\}/, 'in both copies of the card');
  assert.match(app, /referrerpolicy="no-referrer"/, 'the photo request says nothing about where it was opened from');
  assert.match(app, /document\.addEventListener\('error'[^\n]*closest\('\.pv'\)\.remove\(\)[^\n]*true\);/, 'a broken image takes its frame with it');
  assert.match(read('style.css'), /\.detail \.hd \{ display: flex; align-items: center;/, 'the picture sits in a row with the name, so it adds no height of its own');
  assert.match(read('.github/workflows/pages.yml'), /\.nojekyll lib assets _site\//, 'the photo of the Moon is published');
  assert.match(app, /waxing = Astronomy\.MoonPhase\(now\) < 180/);
  assert.doesNotMatch(read('lib/preview.js'), /fetch\(|XMLHttpRequest|localStorage/, 'the preview code asks for nothing itself');
});

/* ---- a generic picture for a flight or a satellite with no photo ---- */
test('a flight and every kind of satellite has a generic drawing, and nothing else does', () => {
  const kinds = { 'AIC144': ['air', 'plane'], 'ISS (ZARYA)': ['sat', 'station'], 'CSS (TIANHE)': ['sat', 'station'], 'CZ-4C R/B': ['sat', 'rocket'], 'COSMOS 2251 DEB': ['sat', 'rocket'], 'SL-8 R/B': ['sat', 'rocket'], 'STARLINK-1007': ['sat', 'starlink'], 'ONEWEB-0012': ['sat', 'starlink'], 'IRIDIUM 33': ['sat', 'starlink'], 'NOAA 19': ['sat', 'satellite'], 'HST': ['sat', 'satellite'] };
  for (const [name, [kind, want]] of Object.entries(kinds)) {
    const g = P.genericArt({ kind, name });
    assert.equal(g.kind, want, name);
    assert.match(g.svg, /^<svg viewBox="0 0 100 100" role="img" aria-label="[^"]+"/, name);
    assert.match(g.label, /generic picture/, name + ': says that it is generic');
    assert.ok(g.svg.length < 2500, name + ' is small: ' + g.svg.length);
  }
  for (const o of [{ kind: 'star', name: 'Vega' }, { kind: 'body', name: 'Mars' }, { kind: 'met', name: 'Perseids' }, null, undefined]) assert.equal(P.genericArt(o), null);
});

test('the generic drawings use no names inside, no script and no address, so they can be in the page twice and are safe', () => {
  for (const o of [{ kind: 'air', name: 'X' }, { kind: 'sat', name: 'ISS' }, { kind: 'sat', name: 'STARLINK-1' }, { kind: 'sat', name: 'A R/B' }, { kind: 'sat', name: 'NOAA' }]) {
    const s = P.genericArt(o).svg;
    assert.doesNotMatch(s, /\bid=|url\(#|<script|onload|href=|https?:|javascript:/i, o.name);
  }
  assert.equal(P.genericArt({ kind: 'sat', name: '"><script>alert(1)</script>' }).kind, 'satellite', 'a hostile name is only a name');
  assert.doesNotMatch(P.genericArt({ kind: 'sat', name: '"><script>alert(1)</script>' }).svg, /script/);
});

test('the kind of a satellite comes from its name', () => {
  assert.equal(P.satKind('iss (zarya)'), 'station'); assert.equal(P.satKind('TIANHE'), 'station');
  assert.equal(P.satKind('FALCON 9 R/B'), 'rocket'); assert.equal(P.satKind('CENTAUR DEB'), 'rocket');
  assert.equal(P.satKind('Starlink-5'), 'starlink'); assert.equal(P.satKind('GOES 16'), 'satellite');
  assert.equal(P.satKind(''), 'satellite'); assert.equal(P.satKind(null), 'satellite');
});

test('the card falls back to the generic picture when there is no photo, and when a photo will not load', () => {
  const app = read('app.js');
  assert.match(app, /const g = kind === 'photo' && P\.genericArt \? P\.genericArt\(o\) : null;/);
  assert.match(app, /class="pv pv-art pv-generic"[^>]*>\$\{g\.svg\}<span class="pv-tag">generic<\/span>/, 'tagged as generic on the picture itself');
  assert.match(app, /wk\.thumb && wt && !badPics\.has\(wk\.thumb\)/, 'a photo that would not load is not tried again');
  assert.match(app, /badPics\.add\(t\.getAttribute\('src'\)\); t\.closest\('\.pv'\)\.remove\(\); renderDetail\(\);/, 'and the card is drawn again with the generic picture');
  assert.match(read('style.css'), /\.detail \.pv-generic \.pv-tag \{[^}]*border-radius: 999px;/, 'the tag is a small pill that does not cut into the drawing');
});
