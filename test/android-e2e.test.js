'use strict';
// The Android emulator test is opt-in (CI has no emulator). These checks keep it wired up and keep it out of `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('npm run test:android runs the emulator compass test, and npm test does not', () => {
  const scripts = JSON.parse(read('package.json')).scripts;
  assert.match(scripts['test:android'], /e2e\/android\/compass\.e2e\.js/);
  assert.equal(scripts.test, 'node --test', 'the normal run is unchanged');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'e2e/android/compass.e2e.js')));
  assert.doesNotMatch('e2e/android/compass.e2e.js', /\.test\.js$/, 'its name is not picked up by node --test');
});

test('the emulator test checks the true heading in places with different declinations, and the drawn N', () => {
  const src = read('e2e/android/compass.e2e.js');
  for (const needle of ['Seattle', 'New York', 'Hyderabad', 'trueHeading', 'deviceorientationabsolute', 'adb', 'isSecureContext', '#facing', '#sky']) {
    assert.ok(src.includes(needle), `mentions ${needle}`);
  }
  assert.match(src, /skip/, 'skips cleanly when there is no emulator');
});

test('the app shows the true heading it is using, next to the radar', () => {
  const app = read('app.js'), html = read('viewer.html');
  assert.match(html, /id="facing"/);
  assert.match(app, /Facing \$\{window\.FarGemsLogic\.dir16\(deg\)\} \$\{deg\}° \(true\)/);
  assert.match(app, /showFacing\(\);/, 'updated on every compass reading');
});
