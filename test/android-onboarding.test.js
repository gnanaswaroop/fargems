'use strict';
// Android tablets: one permission (location), the sky view opens by itself, and an installed app stops being offered.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const O = require('../lib/onboarding.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };

test('only Apple touch devices are asked for the compass, even if another browser has the same function', () => {
  const fn = { requestPermission() {} };
  const env = (userAgent, platform = 'Linux armv8l', maxTouchPoints = 5) => ({ DeviceOrientationEvent: fn, navigator: { userAgent, platform, maxTouchPoints } });
  assert.equal(O.compassNeedsPermission(env('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15')), true);
  assert.equal(O.compassNeedsPermission(env('Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15')), true);
  assert.equal(O.compassNeedsPermission(env('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 'MacIntel', 5)), true, 'an iPad that says it is a Mac');
  assert.equal(O.compassNeedsPermission(env('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 'MacIntel', 0)), false, 'a real Mac has no sensor');
  assert.equal(O.compassNeedsPermission(env('Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 Chrome/126 Safari/537.36')), false, 'an Android tablet needs nothing');
  assert.equal(O.compassNeedsPermission({ DeviceOrientationEvent: {}, navigator: { userAgent: 'iPhone' } }), false, 'no function, no prompt');
  assert.equal(O.compassNeedsPermission({ DeviceOrientationEvent: fn }), true, 'no navigator: judged by the function');
  assert.equal(O.compassNeedsPermission(null), false);
});

test('the permission card says one permission where there is nothing to allow for the compass', () => {
  const a = O.permissionCopy({ needsCompass: false });
  assert.deepEqual([a.title, a.button, a.showCompass], ['One permission', 'Allow location', false]);
  assert.doesNotMatch([a.title, a.button, a.hero, a.privacy].join(' '), /compass/i);
  const i = O.permissionCopy({ needsCompass: true });
  assert.deepEqual([i.title, i.button, i.showCompass], ['Two permissions', 'Allow location and compass', true]);
  assert.deepEqual(O.permissionCopy(), a, 'the default is the simple one');
});

test('a failed position lookup is a refusal only when the visitor said no', () => {
  assert.equal(O.geoFailure(1), 'denied');
  assert.equal(O.geoFailure(2), 'unavailable', 'the device cannot tell where it is');
  assert.equal(O.geoFailure(3), 'unavailable', 'it took too long');
  assert.equal(O.geoFailure(undefined), 'unavailable');
});

test('an installed app is remembered and is not offered again', () => {
  const s = mem();
  assert.equal(O.readInstalled(s), false);
  assert.equal(O.installMode({ installed: O.readInstalled(s), hasPrompt: false }), 'manual');
  O.storeInstalled(s, true);
  assert.equal(O.readInstalled(s), true);
  assert.equal(O.installMode({ installed: true, hasPrompt: false }), 'hidden');
  assert.equal(O.installMode({ installed: true, ios: true }), 'hidden');
  assert.equal(O.installMode({ standalone: true }), 'hidden');
  O.storeInstalled(s, false);
  assert.equal(O.readInstalled(s), false, 'cleared when the browser offers the install again');
  assert.equal(O.installMode({ installed: false, hasPrompt: true }), 'prompt');
  assert.equal(O.storeInstalled({ setItem() { throw new Error('blocked'); } }, true), false, 'blocked storage does not break the page');
  assert.equal(O.readInstalled({ getItem() { throw new Error('blocked'); } }), false);
});

test('the pages use these: install events, a quiet check that goes in, a fallback for a failed lookup, no compass card', () => {
  const js = read('landing.js'), st = read('settings.js'), idx = read('index.html'), man = JSON.parse(read('manifest.webmanifest'));
  assert.match(js, /appinstalled', \(\) => \{ deferredInstall = null; O\.storeInstalled\(storage, true\)/);
  assert.match(js, /beforeinstallprompt', \(e\) => \{ e\.preventDefault\(\); deferredInstall = e; O\.storeInstalled\(storage, false\)/);
  assert.match(js, /installed: O\.readInstalled\(storage\)/);
  assert.match(js, /O\.geoFailure\(geoError\) === 'unavailable'/);
  assert.match(js, /els\.compassRow\.hidden = !copy\.showCompass/);
  assert.match(st, /if \(!O\.compassNeedsPermission\(window\)\) \{ const card = \$\('#compassBtn'\)\.closest\('section'\); if \(card\) card\.hidden = true; \}/);
  assert.match(idx, /<li id="compassRow">/);
  assert.doesNotMatch(js, /requestPermission\(\)[\s\S]{0,80}camera/i, 'the camera is never asked for on the home page');
  assert.doesNotMatch(js, /getUserMedia/, 'the home page never asks for the camera');
  assert.equal(man.orientation, 'any', 'the installed app turns with a tablet (it used to be locked to portrait)');
});
