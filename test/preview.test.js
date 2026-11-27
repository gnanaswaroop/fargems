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
    assert.doesNotMatch(s, /<script|onload|href=/i, n + ': nothing active');
  }
  assert.equal(P.bodyArt({ kind: 'air', name: 'AI101' }), null);
  assert.equal(P.bodyArt({ kind: 'star', name: 'Sirius' }), null);
  assert.equal(P.bodyArt(null), null);
});

test('the Moon is drawn as it is lit: new is dark, full is whole, and the lit side follows waxing and waning', () => {
  assert.doesNotMatch(P.moonArt(0, true), /<path|url\(#pvMoon\)"\/>/, 'new Moon: no lit part');
  assert.match(P.moonArt(1, true), /<circle r="40" fill="url\(#pvMoon\)"\/>/, 'full Moon: the whole disc');
  const wax = P.moonArt(0.25, true), wane = P.moonArt(0.25, false);
  assert.match(wax, /scale\(1 1\)/); assert.match(wane, /scale\(-1 1\)/, 'waning is lit on the other side');
  assert.match(P.moonArt(0.25, true, true), /scale\(-1 1\)/, 'seen from the south the sides are the other way round');
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
  assert.match(a, /id="pvMoona"/); assert.match(a, /url\(#pvMoona\)/); assert.match(b, /id="pvMoonb"/);
  assert.doesNotMatch(a, /pvMoonb/);
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
  assert.match(app, /\$\{previewHtml\(o, wt, wk, 'a'\)\}<h3>/); assert.match(app, /\$\{previewHtml\(o, wt, wk, 'b'\)\}<h3>/, 'in both copies of the card');
  assert.match(app, /referrerpolicy="no-referrer"/, 'the photo request says nothing about where it was opened from');
  assert.match(app, /document\.addEventListener\('error'[^\n]*closest\('\.pv'\)\.remove\(\)[^\n]*true\);/, 'a broken image takes its frame with it');
  assert.match(read('style.css'), /\.detail \.route \{ clear: both; \}/, 'the From and To row is not squeezed beside the picture');
  assert.match(app, /waxing = Astronomy\.MoonPhase\(now\) < 180/);
  assert.doesNotMatch(read('lib/preview.js'), /fetch\(|XMLHttpRequest|localStorage/, 'the preview code asks for nothing itself');
});
