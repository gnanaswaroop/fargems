'use strict';
// The About page is short, and carries the privacy statement, the terms and the licence, and the project link.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const text = (html) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('the About page is short enough to read', () => {
  const words = text(read('about.html').match(/<main[\s\S]*<\/main>/)[0]).split(' ').filter(Boolean).length;
  assert.ok(words < 480, `About has ${words} words`);
});

test('privacy: no location is collected by the app, third parties and Cloudflare are disclosed', () => {
  const t = text(read('about.html'));
  assert.match(t, /does not collect your location/);
  assert.match(t, /stay on your device/);
  assert.match(t, /public data services/);
  assert.match(t, /Cloudflare, which may process standard request data/);
  assert.match(t, /No accounts, no advertising and no tracking cookies/);
});

test('terms: MIT licence, no warranty, no responsibility for data sent to others, not for safety use', () => {
  const html = read('about.html'), t = text(html);
  assert.match(t, /MIT licence/);
  assert.match(t, /without warranty/);
  assert.match(t, /not responsible for any data your device sends to third-party services/);
  assert.match(t, /Do not use FarGems for navigation, aviation or safety/);
  assert.match(read('LICENSE'), /^MIT License/);
});

test('the GitHub link moved from the menu to the About page', () => {
  assert.doesNotMatch(read('index.html').match(/<ul id="menuList"[\s\S]*?<\/ul>/)[0], /github/i);
  assert.match(read('about.html'), /href="https:\/\/github\.com\/gnanaswaroop\/fargems" rel="noopener">GitHub</);
});
