'use strict';
// The landing page: the animated hero, the feature cards, the steps, and honest copy.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('landing page opens with a hero sky picture that has a text description', () => {
  const html = read('index.html');
  assert.match(html, /<svg class="hero"[^>]*role="img"[^>]*aria-label="[^"]+"/);
  assert.ok(html.indexOf('class="hero"') < html.indexOf('id="permsTitle"'), 'hero comes before the permission card');
  assert.match(html, /class="tagline"/);
  assert.match(html, /<animateMotion/);
});

test('hero motion stops for visitors who prefer reduced motion', () => {
  assert.match(read('style.css'), /prefers-reduced-motion:reduce\)\{\.hero-sweep/);
  assert.match(read('landing.js'), /prefers-reduced-motion: reduce[\s\S]*pauseAnimations/);
});

test('landing page shows what is in the sky and how it works, and keeps the permission controls', () => {
  const html = read('index.html');
  assert.equal((html.match(/class="peek-item"/g) || []).length, 4);
  assert.match(html, /id="stepsTitle"/);
  assert.equal((html.match(/<ol>[\s\S]*?<\/ol>/)[0].match(/<li>/g) || []).length, 3);
  for (const id of ['allowBtn', 'sampleBtn', 'openLink', 'manualForm', 'installCard']) assert.ok(html.includes(`id="${id}"`), id);
});

test('about lives on its own page, linked from the landing page', () => {
  const landing = read('index.html');
  assert.match(landing, /href="about\.html"/);
  assert.doesNotMatch(landing, /id="about"/, 'the long text is no longer on the landing page');
  assert.match(read('about.html'), /href="index\.html"/, 'a way back');
  assert.match(read('sw.js'), /'about\.html'/);
  assert.match(read('.github/workflows/pages.yml'), /about\.html/);
});

test('the about text matches what the app now does', () => {
  const html = read('about.html');
  assert.match(html, /Camera view/);
  assert.match(html, /where they are flying to/);
  assert.match(html, /adsbdb/);
  assert.match(html, /OpenSky/, 'the fallback feed stays listed');
  assert.doesNotMatch(html, /no server of ours/, 'the aircraft relay is disclosed');
  assert.match(html, /small relay/);
});

test('About and GitHub sit in a "..." menu at the top right, which opens, closes and is labelled for screen readers', () => {
  const html = read('index.html'), js = read('landing.js'), css = read('style.css');
  const menu = html.match(/<nav class="menu"[\s\S]*?<\/nav>/)[0];
  assert.ok(html.indexOf('class="menu"') < html.indexOf('class="hero"'), 'the menu comes first, at the top');
  assert.match(menu, /id="menuBtn"[^>]*aria-label="More"[^>]*aria-expanded="false"[^>]*aria-controls="menuList"/);
  assert.match(menu, /<ul id="menuList" class="menu-list" hidden>/);
  assert.match(menu, /href="about\.html">About</);
  assert.match(menu, /href="https:\/\/github\.com\/gnanaswaroop\/fargems"/);
  assert.match(css, /\.menu\{[^}]*justify-content:flex-end/, 'pushed to the right');
  assert.match(css, /\.menu-list\{position:absolute;right:0/);
  assert.match(js, /aria-expanded/);
  assert.match(js, /e\.key === 'Escape'/);
  assert.match(js, /menuList\.contains\(e\.target\)/, 'a tap outside closes it');
});
