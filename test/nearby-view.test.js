'use strict';
// The sky view's nearby list (an icon and the type of each object), the radar controls under the radar, and text that can
// be selected without the page throwing the selection away.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../lib/logic.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('typeOf names the kind of every object in the list', () => {
  assert.deepEqual(L.typeOf({ kind: 'air', name: 'UAL1' }), { key: 'air', label: 'Aircraft' });
  assert.deepEqual(L.typeOf({ kind: 'sat', name: 'STARLINK-1' }), { key: 'sat', label: 'Satellite' });
  assert.deepEqual(L.typeOf({ kind: 'sat', name: 'ISS (ZARYA)' }), { key: 'station', label: 'Space station' });
  assert.deepEqual(L.typeOf({ kind: 'sat', name: 'CSS (TIANHE)' }), { key: 'station', label: 'Space station' });
  assert.deepEqual(L.typeOf({ kind: 'body', name: 'Sun' }), { key: 'sun', label: 'Sun' });
  assert.deepEqual(L.typeOf({ kind: 'body', name: 'Moon' }), { key: 'moon', label: 'Moon' });
  assert.deepEqual(L.typeOf({ kind: 'body', name: 'Jupiter' }), { key: 'planet', label: 'Planet' });
  assert.deepEqual(L.typeOf({ kind: 'star', name: 'Vega' }), { key: 'star', label: 'Star' });
  assert.deepEqual(L.typeOf({ kind: 'met', name: 'Perseids' }), { key: 'met', label: 'Meteor shower' });
  assert.deepEqual(L.typeOf(null), { key: 'star', label: 'Star' }, 'never throws');
});

test('nearby rows show an icon, the name, the type in words, the distance and where to look', () => {
  const app = read('app.js');
  const icons = app.match(/const NEARBY_ICONS = \{([\s\S]*?)\n\};/)[1];
  for (const key of ['air', 'sat', 'station', 'sun', 'moon', 'planet', 'star', 'met']) assert.match(icons, new RegExp('\\n  ' + key + ': '), `an icon for ${key}`);
  assert.match(app, /const t = H\.typeOf\(o\);/);
  assert.match(app, /<span class="ico" aria-hidden="true">/, 'the icon is decoration: the type is also written out');
  assert.match(app, /<span class="tag">\$\{esc\(t\.label\)\}<\/span>/);
  assert.match(app, /data-type="\$\{t\.key\}"/);
  assert.match(app, /\(NEARBY_ICONS\[t\.key\] \|\| NEARBY_ICONS\.star\)\(o\)/, 'an unknown kind still gets an icon');
  const css = read('style.css');
  assert.match(css, /\.nearby-row \.ico \{[^}]*border-radius: 50%/);
  assert.match(css, /\.nearby-row \.tag \{/);
  assert.match(css, /grid-template-columns: 34px 1fr auto/);
});

test('nearby rows are text blocks you can select, and a keyboard can still use them', () => {
  const app = read('app.js'), css = read('style.css');
  assert.match(app, /<div class="nearby-row[^"]*" data-id="[^"]*" data-type="[^"]*" role="button" tabindex="0">/);
  assert.doesNotMatch(app, /<button class="nearby-row/, 'a button\'s text cannot be selected');
  assert.match(app, /onkeydown = \(e\) => \{ if \(e\.key === 'Enter' \|\| e\.key === ' '\)/);
  assert.match(css, /\.nearby-row \{[^}]*user-select: text/);
  assert.match(css, /#detail, #status, #hud, \.nearby-list, #passes \{ user-select: text;/);
});

test('the page does not throw away selected text: unchanged content is not rewritten, selected content is left alone, swipes ignore selections', () => {
  const app = read('app.js');
  assert.match(app, /function setHtml\(el, html\) \{\s*if \(!el \|\| el\.__html === html\) return;/);
  assert.match(app, /!sel\.isCollapsed && sel\.rangeCount && el\.contains\(sel\.anchorNode\)\) return;/);
  for (const re of [/setHtml\(\$\('#hud'\)/, /setHtml\(\$\('#status'\)/, /setHtml\(\$\('#detail'\)/, /setHtml\(el, '<h3>Next station passes/, /setHtml\(el, sorted\.map/]) assert.match(app, re);
  assert.doesNotMatch(app, /\$\('#(hud|status|detail|arDetail)'\)\.innerHTML = (?!'<span class="bad">)/, 'no direct rewrites of the refreshed containers');
  assert.match(app, /if \(!b \|\| e\.target\.closest\('a'\) \|\| hasSelection\(\)\) return;/, 'a link is not a tap on the row, and selecting across a row is not a tap either');
  assert.match(app, /if \(hasSelection\(\)\) \{ sw = null; return; \}/, 'a drag that selected text is not a swipe');
});

test('the radar controls sit in a row under the radar, not on top of it', () => {
  const css = read('style.css'), html = read('viewer.html');
  assert.match(css, /\.zoombar \{ display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin: 10px 0 0; \}/);
  assert.doesNotMatch(css, /\.zoombar \{ position: absolute/);
  const sky = html.indexOf('<canvas id="sky"'), bar = html.indexOf('class="zoombar"');
  assert.ok(sky > -1 && bar > sky, 'the controls come after the radar');
  for (const id of ['zoomIn', 'zoomOut', 'zoomReset', 'arBtn']) assert.ok(html.includes(`id="${id}"`), id);
});
