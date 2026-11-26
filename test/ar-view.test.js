'use strict';
// The AR view's wiring: pages, scripts, publishing and service worker lists, and the code paths it relies on.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('viewer has the AR overlay elements that ar-view.js and app.js look up', () => {
  const html = read('viewer.html');
  for (const id of ['ar', 'arVideo', 'arCanvas', 'arClose', 'arDetail', 'arBtn']) assert.match(html, new RegExp('id="' + id + '"'), id);
  assert.match(html, /<video[^>]*playsinline/, 'iPhone needs playsinline to show the camera in the page');
  assert.match(html, /<div id="ar" class="ar" hidden>/, 'the overlay starts hidden');
});

test('viewer loads the AR maths and view before app.js', () => {
  const html = read('viewer.html');
  const ar = html.indexOf('lib/ar.js'), view = html.indexOf('ar-view.js'), logic = html.indexOf('lib/logic.js'), app = html.indexOf('src="app.js"');
  assert.ok(logic < ar && ar < view && view < app);
});

test('the AR files are published and cached for offline use', () => {
  assert.match(read('.github/workflows/pages.yml'), /ar-view\.js/);
  assert.match(read('sw.js'), /'lib\/ar\.js'/);
  assert.match(read('sw.js'), /'ar-view\.js'/);
});

test('the camera is asked for the back camera, without audio, and stopped on close', () => {
  const js = read('ar-view.js');
  assert.match(js, /facingMode: \{ ideal: 'environment' \}/);
  assert.match(js, /audio: false/);
  assert.match(js, /getTracks\(\)\) t\.stop\(\)/);
});

test('app opens AR from a tap and automatically when the phone is raised, but not after a manual close', () => {
  const app = read('app.js');
  assert.match(app, /\$\('#arBtn'\)\.onclick = \(\) => openAR\('manual'\)/);
  assert.match(app, /openAR\('auto'\)/);
  assert.match(app, /autoStep/);
  assert.match(app, /fg\.camera/);
  assert.match(app, /onClose: \(\) => \{ arState\.openedBy = null; dropArEntry\(\); arState\.auto = window\.FarGemsAR\.suppress\(arState\.auto\); \}/);
  assert.match(app, /closeAllowed: arState\.openedBy === 'auto'/, 'only a view that opened by itself closes by itself');
  assert.match(app, /arState\.opening/, 'only one camera attempt at a time');
  assert.match(app, /requestPermission\(\)/, 'iPhone compass permission is requested inside the tap');
});

test('the selected-object card is shared between the radar page and the AR overlay', () => {
  const app = read('app.js');
  assert.match(app, /setHtml\(\$\('#detail'\), X \+ h\); setHtml\(\$\('#arDetail'\), X \+ h\)/);
});

test('the AR overlay sits above the page and fills the screen', () => {
  const css = read('style.css');
  assert.match(css, /\.ar \{[^}]*position: fixed; inset: 0/);
  assert.match(css, /\.ar\[hidden\] \{ display: none; \}/);
});
