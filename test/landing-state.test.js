'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../lib/onboarding.js');

test('before any permission is asked, the landing page offers the permission button and a sample', () => {
  const s = O.landingState({ hasLocation: false, attempted: false });
  assert.equal(s.phase, 'ask');
  assert.equal(s.showAllow, true);
  assert.equal(s.showSample, true);
  assert.equal(s.showOpen, false);
  assert.equal(s.showForm, false);
});

test('once location is granted, the page switches to ready: no permission button, open the sky view', () => {
  const s = O.landingState({ hasLocation: true, attempted: true });
  assert.equal(s.phase, 'ready');
  assert.equal(s.showAllow, false, 'the permission button is replaced');
  assert.equal(s.showSample, false);
  assert.equal(s.showOpen, true, 'the sky view button appears');
  assert.equal(s.showForm, false);
  assert.equal(s.showAllowAgain, true, 'a link lets the visitor change permissions');
});

test('if location was refused, the page offers manual coordinates and no open button', () => {
  const s = O.landingState({ hasLocation: false, attempted: true });
  assert.equal(s.phase, 'manual');
  assert.equal(s.showForm, true);
  assert.equal(s.showOpen, false);
  assert.equal(s.showAllow, false);
});

test('ready state reports the compass as allowed, denied or not needed', () => {
  assert.equal(O.landingState({ hasLocation: true, attempted: true, compass: 'granted' }).compassText, 'Allowed');
  assert.match(O.landingState({ hasLocation: true, attempted: true, compass: 'denied' }).compassText, /Not allowed/);
  assert.equal(O.landingState({ hasLocation: true, attempted: true, compass: 'na' }).compassText, 'Not needed on this device');
  assert.equal(O.landingState({ hasLocation: true, attempted: true, compass: null }).compassText, 'Not asked yet');
});

test('installMode: hidden when already installed, a prompt when the browser offers one, instructions on iOS', () => {
  assert.equal(O.installMode({ standalone: true, ios: false, hasPrompt: true }), 'hidden', 'already installed');
  assert.equal(O.installMode({ standalone: false, ios: false, hasPrompt: true }), 'prompt');
  assert.equal(O.installMode({ standalone: false, ios: true, hasPrompt: false }), 'ios', 'iOS has no install prompt');
  assert.equal(O.installMode({ standalone: false, ios: false, hasPrompt: false }), 'manual', 'no browser prompt yet: point to the browser menu');
});
