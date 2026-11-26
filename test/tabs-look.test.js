'use strict';
// The Radar and Nearby tabs as one segmented control, with an icon each and a count on Nearby; sharing is called "Tell a friend".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('each tab has an icon that screen readers skip, and Nearby has a count that starts hidden', () => {
  const v = read('viewer.html');
  const radar = v.match(/<button id="tabRadar"[^>]*>([\s\S]*?)<\/button>/)[1], nearby = v.match(/<button id="tabNearby"[^>]*>([\s\S]*?)<\/button>/)[1];
  assert.match(radar, /^<svg class="tab-ico"[^>]*aria-hidden="true">[\s\S]*<\/svg><span>Radar<\/span>$/);
  assert.match(nearby, /^<svg class="tab-ico"[^>]*aria-hidden="true">[\s\S]*<\/svg><span>Nearby<\/span><span id="nearbyCount" class="count" hidden><\/span>$/);
  // The tab list is still a proper one (the earlier accessibility work is untouched).
  assert.match(v, /id="tabRadar"[^>]*role="tab"[^>]*aria-controls="pageRadar"/);
  assert.match(v, /id="tabNearby"[^>]*role="tab"[^>]*aria-controls="pageNearby"/);
});

test('the tabs are one rounded control with the chosen tab filled, and the count follows the list', () => {
  const css = read('style.css'), app = read('app.js');
  assert.match(css, /\.tabs \{ display: flex; gap: 4px; margin: 10px 0; padding: 4px; border: 1px solid var\(--line\); border-radius: 999px; background: var\(--card\); \}/);
  assert.match(css, /\.tab\.on \{ color: var\(--accent\); background: rgba\(90, 209, 230, \.16\); box-shadow: inset 0 0 0 1px rgba\(90, 209, 230, \.55\); \}/);
  assert.match(css, /\.tab \{[^}]*min-height: 40px;/, 'a big enough target');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.tab \{ transition: none; \} \}/);
  assert.match(css, /#sky:focus-visible, \.tab:focus-visible \{ outline: 2px solid var\(--accent\)/, 'the keyboard focus ring stays');
  assert.match(app, /const count = \$\('#nearbyCount'\); if \(count\) \{ count\.textContent = String\(items\.length\); count\.hidden = !items\.length; \}/);
});

test('sharing is called Tell a friend in every place, under the heading Pass it on in Settings', () => {
  assert.match(read('index.html'), /id="menuShare"[^>]*>Tell a friend</);
  assert.match(read('viewer.html'), /id="gearShare"[^>]*>Tell a friend</);
  const s = read('settings.html');
  assert.match(s, /<h2 id="shareTitle">Pass it on<\/h2>/);
  assert.match(s, /id="shareApp"[^>]*>Tell a friend</);
  assert.doesNotMatch(s + read('index.html') + read('viewer.html'), />Share FarGems</, 'the old wording is gone');
});
