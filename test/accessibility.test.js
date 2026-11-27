'use strict';
// Keyboard and screen-reader access to the viewer: a proper tab list, a radar the keyboard can walk, and an AR switch.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../lib/logic.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('the Radar/Nearby switcher is a complete tab list', () => {
  const v = read('viewer.html'), app = read('app.js');
  assert.match(v, /id="tabRadar"[^>]*aria-controls="pageRadar" tabindex="0"/);
  assert.match(v, /id="tabNearby"[^>]*aria-controls="pageNearby" tabindex="-1"/);
  assert.match(v, /id="pageRadar" role="tabpanel" aria-labelledby="tabRadar"/);
  assert.match(v, /id="pageNearby" role="tabpanel" aria-labelledby="tabNearby"/);
  assert.match(app, /\$\('#tabRadar'\)\.tabIndex = nearby \? -1 : 0/, 'only the current tab is in the tab order');
  assert.match(app, /\['ArrowLeft', 'ArrowRight', 'Home', 'End'\]/, 'arrow keys switch tabs');
  assert.match(app, /\$\('#pageRadar'\)\.inert = !wide && nearby;/, 'the page that is out of sight is not reachable');
  assert.match(app, /\$\('#pageNearby'\)\.inert = !wide && !nearby;/);
});

test('the radar can be used from the keyboard and is described for screen readers', () => {
  const v = read('viewer.html'), app = read('app.js'), css = read('style.css');
  assert.match(v, /<canvas id="sky" role="img" tabindex="0" aria-label="[^"]+" aria-describedby="skyHint">/);
  assert.match(v, /<p id="skyHint" class="sr-only">[^<]*arrow keys[^<]*Nearby tab[^<]*<\/p>/);
  assert.match(app, /cv\.addEventListener\('keydown'/);
  assert.match(css, /\.sr-only \{ position: absolute; width: 1px; height: 1px;/);
  assert.match(css, /#sky:focus-visible/, 'a visible focus ring');
});

test('stepObject walks around the sky by direction, wrapping, and ignores objects below the horizon', () => {
  const o = (id, az, el) => ({ id, az, el });
  const objs = [o('b', 200, 30), o('a', 10, 5), o('c', 300, 60), o('hidden', 100, -4)];
  assert.equal(L.stepObject(objs, null, 1), 'a', 'nothing selected: the first going right');
  assert.equal(L.stepObject(objs, null, -1), 'c', 'nothing selected: the last going left');
  assert.equal(L.stepObject(objs, 'a', 1), 'b');
  assert.equal(L.stepObject(objs, 'c', 1), 'a', 'wraps round');
  assert.equal(L.stepObject(objs, 'a', -1), 'c');
  assert.equal(L.stepObject(objs, 'hidden', 1), 'a', 'an unknown selection starts again');
  assert.equal(L.stepObject([], null, 1), null);
  assert.equal(L.stepObject(null, null, 1), null);
});

test('the camera view opens by itself unless the visitor turns that off in Settings', () => {
  assert.equal(L.parseAutoAr(null), true);
  assert.equal(L.parseAutoAr('1'), true);
  assert.equal(L.parseAutoAr('0'), false);
  assert.match(read('settings.html'), /<b>Open the camera view by itself<\/b>.*<input id="autoArToggle" type="checkbox" role="switch">/);
  assert.match(read('settings.js'), /fg\.autoAr/);
  assert.match(read('app.js'), /parseAutoAr\(storedValue\('fg\.autoAr'\)\) && !arView\.isOpen\(\)\) return/);
});

test('small screens: rows in a card are spaced, long values wrap inside the card, and a very narrow card stacks label over value', () => {
  const css = read('style.css');
  assert.match(css, /\.card > \.layer-row \{ margin-top: 10px; \}/);
  assert.match(css, /\.card dd, \.about dd \{ overflow-wrap: anywhere; min-width: 0; \}/);
  assert.match(css, /@media \(max-width: 340px\) \{\s*\.card dl \{ grid-template-columns: minmax\(0, 1fr\)/);
});

test('the sky view starts with a loading screen: the logo, the name and what the app is, which goes once the view has drawn', () => {
  const html = read('viewer.html'), app = read('app.js'), css = read('style.css');
  assert.match(html, /<body class="viewer">\s*<div id="boot" class="boot" role="status"[^>]*><img src="icon\.svg"[^>]*><div class="boot-name">Far<b>Gems<\/b><\/div><div class="boot-title">What’s flying above you<\/div>/);
  assert.match(app, /const boot = \$\('#boot'\);[^\n]*\n\s*if \(boot\) \{ boot\.classList\.add\('done'\); setTimeout\(\(\) => boot\.remove\(\), 500\); \}/);
  assert.match(css, /\.boot \{[^}]*animation: bootout \.4s 6s forwards/, 'and goes by itself if the page cannot start');
  assert.match(css, /\.boot\.done \{[^}]*pointer-events: none/);
});

test('settings: every on/off choice is a switch with a title and a hint, and the AR one says "show" and is on by default', () => {
  const html = read('settings.html'), css = read('style.css'), js = read('settings.js');
  for (const id of ['flipToggle', 'visOnlyToggle', 'autoArToggle', 'arSymbolsToggle']) assert.match(html, new RegExp(`<input id="${id}" type="checkbox" role="switch">`), id + ' is a switch');
  assert.doesNotMatch(html, /class="layer-row"><input id=/, 'no plain checkbox rows are left in the display card');
  assert.match(css, /body\.settings input\[type="checkbox"\] \{ -webkit-appearance: none; appearance: none;/, 'the switch look');
  assert.match(css, /body\.settings \.setting select \{ width: 100%;/, 'lists sit full width under their title');
  assert.match(js, /\$\('#arSymbolsToggle'\)\.checked = L\.parseArSymbols\(storage\.getItem\('fg\.arSymbols'\)\);/, 'on unless it was turned off');
  assert.match(js, /e\.target\.checked \? '1' : '0'\)\);\s*\/\/ Farthest|fg\.arSymbols', e\.target\.checked \? '1' : '0'/);
  assert.match(js, /`<label class="layer-row"><input type="checkbox" data-layer/, 'the layer switches use the same checkbox');
});

test('settings: the farthest-flight number keeps a box wide enough for its value, without spin arrows, and drops under its title on narrow screens', () => {
  const css = read('style.css');
  assert.match(css, /body\.settings \.setting input\[type="number"\] \{[^}]*width: 6em; min-width: 6em; flex: none;/);
  assert.match(css, /::-webkit-inner-spin-button[^}]*-webkit-appearance: none/);
  assert.match(css, /@media \(max-width: 400px\) \{\s*body\.settings \.setting:has\(input\[type="number"\]\) \{ flex-direction: column/);
});
