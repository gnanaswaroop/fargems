'use strict';
// Settings > Calibrate: explains the line-up, shows the saved correction, clears it, and opens the camera view in line-up mode.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('settings has a Calibrate card with a link into the camera view and a reset, and it is always shown', () => {
  const html = read('settings.html'), js = read('settings.js');
  assert.match(html, /<h2 id="calTitle">Calibrate<\/h2>/);
  assert.match(html, /<a id="calBtn" class="btn wide primary" href="viewer\.html\?calibrate=1">Calibrate with the camera<\/a>/);
  assert.match(html, /<button id="calReset"/);
  assert.match(html, /Never stare at the Sun through the camera/);
  assert.match(html, /<script defer src="lib\/ar\.js"><\/script>/, 'the correction is read with the same parser as the sky view');
  assert.doesNotMatch(js, /calBtn[^;]*hidden|calTitle[^;]*hidden/, 'unlike the compass card it is for every device');
  assert.match(js, /storage\.setItem\('fg\.arOffset', JSON\.stringify\(\{ h: 0, p: 0 \}\)\)/);
});

test('the sky view opens straight into line-up mode for ?calibrate=1 and drops the flag', () => {
  const app = read('app.js');
  assert.match(app, /\/\[\?&\]calibrate=1\\b\/\.test\(location\.search\)/);
  assert.match(app, /openAR\('manual'\)\.then\(\(\) => \{ if \(arView && arView\.isOpen\(\) && arState\.setAlign\) arState\.setAlign\(true\); \}\)/);
  assert.match(app, /history\.replaceState\(history\.state, '', location\.pathname \+ location\.hash\)/);
});

test('the sky and the settings page both use the saved correction key, and the service worker has what settings loads', () => {
  assert.match(read('app.js'), /'fg\.arOffset'/);
  assert.match(read('sw.js'), /'lib\/ar\.js'/);
});
