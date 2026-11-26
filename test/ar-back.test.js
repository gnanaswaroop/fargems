'use strict';
// The camera view has its own step in the browser history, so a swipe back closes it instead of leaving the sky view.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

test('opening the camera view adds a history step, and a popstate closes the view', () => {
  assert.match(app, /arView\.open\(\);\s*arState\.openedBy = source;\s*try \{ history\.pushState\(\{ fgAr: 1 \}, ''\); arState\.pushed = true; \}/);
  assert.match(app, /addEventListener\('popstate', \(\) => \{\s*if \(!arView\.isOpen\(\)\) return;\s*arState\.pushed = false;[^}]*arView\.close\(\);/);
});

test('closing by the X or by laying the phone flat removes that step again', () => {
  assert.match(app, /onClose: \(\) => \{ arState\.openedBy = null; dropArEntry\(\);/);
  assert.match(app, /arView\.close\(\); arState\.openedBy = null; dropArEntry\(\);/);
  assert.match(app, /function dropArEntry\(\) \{ if \(arState\.pushed\) \{ arState\.pushed = false; try \{ history\.back\(\)/);
});
