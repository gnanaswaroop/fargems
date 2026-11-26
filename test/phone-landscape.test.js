'use strict';
// A phone on its side: the sky view is sized by the height of the screen, and the app can be installed from the gear menu.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const O = require('../lib/onboarding.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('the sideways layout starts at phone width, and has a compact version for short screens', () => {
  const css = read('style.css');
  assert.match(css, /@media \(min-width: 560px\) and \(min-aspect-ratio: 5\/4\) \{/, 'two columns from the width of a phone on its side');
  assert.equal((read('app.js').match(/\(min-width: 560px\) and \(min-aspect-ratio: 5\/4\)/g) || []).length, 2, 'the page script asks the same question');
  const short = css.match(/@media \(min-width: 560px\) and \(min-aspect-ratio: 5\/4\) and \(max-height: 560px\) \{([\s\S]*?)\n\}/)[1];
  assert.match(short, /--rs: min\(calc\(100dvh - 92px\), 640px, calc\(100vw - 330px\)\)/, 'the radar is sized by the height of the screen');
  assert.match(short, /\.skywrap \{ display: contents; \}/, 'so the zoom buttons can stand beside it');
  assert.match(short, /\.zoombar \{[^}]*flex-direction: column/);
  assert.match(short, /\.side \{[^}]*overflow-y: auto/, 'the details scroll inside their own column');
  assert.match(short, /\.landing \.hero-row \{ display: none; \}/, 'the home page drops its picture');
  assert.match(css, /@media \(min-width: 560px\) and \(max-width: 699px\) and \(min-aspect-ratio: 5\/4\) \{\s*\.landing \.welcome:not\(\.wide\) \{ display: block; min-height: 0; \}/, 'the narrowest keep one column');
});

test('the radar canvas is not clipped to a circle, so names and things outside the horizon circle show', () => {
  assert.doesNotMatch(read('style.css').match(/#sky\{[^}]*\}/)[0], /border-radius/);
});

test('the sky view can install the app from the gear menu', () => {
  const v = read('viewer.html'), app = read('app.js');
  assert.match(v, /<li><button id="gearInstall" class="menu-item" type="button">Install app<\/button><\/li>/);
  assert.match(app, /window\.addEventListener\('beforeinstallprompt', \(e\) => \{ e\.preventDefault\(\); install\.prompt = e; O\.storeInstalled\(store, false\); syncInstall\(\); \}\);/);
  assert.match(app, /window\.addEventListener\('appinstalled', \(\) => \{ install\.prompt = null; O\.storeInstalled\(store, true\); syncInstall\(\); \}\);/);
  assert.match(app, /p\.prompt\(\); try \{ await p\.userChoice; \}/, 'starts the browser\'s own prompt');
  assert.match(app, /toast\(O\.installHelp\(\{ ios \}\), 7000\)/, 'or says how');
  assert.match(app, /\$\('#gearInstall'\)\.parentElement\.hidden = O\.installMode\(/);
  assert.match(v, /<script src="lib\/onboarding\.js"><\/script>/, 'the viewer loads the install rules');
});

test('installHelp says how to install where the browser has no prompt', () => {
  assert.equal(O.installHelp({ ios: true }), 'On iPhone or iPad: tap the Share button, then Add to Home Screen.');
  assert.equal(O.installHelp({}), 'Open your browser menu and choose Install app, or Add to Home screen.');
  assert.equal(O.installHelp(), O.installHelp({ ios: false }));
  assert.equal(O.installMode({ installed: true, hasPrompt: true }), 'hidden', 'installed: nothing to offer');
  assert.equal(O.installMode({ standalone: true }), 'hidden', 'already the installed app');
});
