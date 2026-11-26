'use strict';
// The details can be closed, and the radar keeps a dark sky with the horizon as an outline.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('every details card has a cross, Escape closes it too, and a closed card stays away until something is picked', () => {
  const app = read('app.js'), css = read('style.css');
  assert.match(app, /<button type="button" class="close-detail" data-close-detail aria-label="Close the details">✕<\/button>/);
  assert.match(app, /const closed = !!state\.detailClosed && state\.detailClosed\.sel === state\.sel;/);
  assert.match(app, /if \(!closed\) state\.detailClosed = null;/, 'picking something else reopens it');
  assert.match(app, /\$\('#detail'\)\.hidden = closed; \$\('#arDetail'\)\.hidden = closed;/, 'in the camera view too');
  assert.match(app, /function closeDetail\(\) \{\s*state\.sel = null; state\.passSel = null; state\.detailClosed = \{ sel: null \};/);
  assert.match(app, /e\.key === 'Escape' && gearList\.hidden && \(state\.sel \|\| state\.passSel\)/);
  assert.match(app, /e\.target\.closest\('\[data-close-detail\]'\)\) closeDetail\(\)/);
  assert.match(app, /function choosePass\(i\) \{\s*const p = state\.passes\[i\];\s*if \(!p\) return;\s*state\.detailClosed = null;/, 'choosing a pass opens the card');
  assert.match(css, /\.close-detail \{ position: absolute;/);
  assert.match(css, /\.detail:not\(\.ar-detail\) \{ position: relative; \}/, 'the camera view card keeps its own placing');
  assert.match(css, /\.detail\[hidden\] \{ display: none; \}/);
});

test('the radar sky is always dark and the horizon is an outline; names may cross it but not leave the canvas', () => {
  const app = read('app.js');
  assert.doesNotMatch(app, /mix\(\[6, 10, 24\], \[40, 92, 160\], k\)/, 'the blue day gradient is gone');
  assert.match(app, /g\.addColorStop\(0, 'rgb\(6,10,24\)'\);\s*g\.addColorStop\(1, 'rgb\(14,22,44\)'\);/);
  assert.match(app, /ctx\.strokeStyle = 'rgba\(130,160,210,\.55\)'; ctx\.lineWidth = 1\.5; ctx\.beginPath\(\); ctx\.arc\(cx, cy, R, 0, 7\); ctx\.stroke\(\);/, 'the circle has an outline');
  assert.match(app, /o\.el < -6\) continue;/, 'a little below the horizon is still drawn');
  assert.match(app, /const p = P\(o\.az, Math\.max\(-6, o\.el\)\);/, 'outside the rim');
  assert.match(app, /const fits = \(r\) => r\.x0 >= 2 && r\.x1 <= W - 2 && r\.y0 >= 0 && r\.y1 <= W;/);
  assert.doesNotMatch(app, /const inside = /);
});
