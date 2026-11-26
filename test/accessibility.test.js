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
  assert.match(read('settings.html'), /<label class="layer-row"><input id="autoArToggle" type="checkbox"> Open the camera view by itself/);
  assert.match(read('settings.js'), /fg\.autoAr/);
  assert.match(read('app.js'), /parseAutoAr\(storedValue\('fg\.autoAr'\)\) && !arView\.isOpen\(\)\) return/);
});
