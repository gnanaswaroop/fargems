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

test('the home page is simple, keeps the permission controls, and the explanations live on the About page', () => {
  const html = read('index.html'), about = read('about.html');
  for (const id of ['allowBtn', 'sampleBtn', 'openLink', 'manualForm', 'installCard', 'permsCard', 'heroLink']) assert.ok(html.includes(`id="${id}"`), id);
  for (const gone of ['class="peek"', 'class="steps"', '<footer', 'class="about-link"']) assert.ok(!html.includes(gone), `home page no longer has ${gone}`);
  assert.match(about, /<h3>How it works<\/h3>\s*<div class="steps">[\s\S]*<ol>/);
  assert.equal((about.match(/<ol>[\s\S]*?<\/ol>/)[0].match(/<li>/g) || []).length, 3);
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
  assert.match(html, /adsbdb/);
  assert.match(html, /OpenSky/, 'the fallback feed stays listed');
  assert.doesNotMatch(html, /no server of ours/, 'the aircraft relay is disclosed');
  assert.match(html, /small relay/);
});

test('About sits in a "..." menu at the top right, which opens, closes and is labelled for screen readers', () => {
  const html = read('index.html'), js = read('landing.js'), css = read('style.css');
  const menu = html.match(/<nav class="menu"[\s\S]*?<\/nav>/)[0];
  assert.ok(html.indexOf('class="menu"') < html.indexOf('class="hero"'), 'the menu comes first, at the top');
  assert.match(menu, /id="menuBtn"[^>]*aria-label="More"[^>]*aria-expanded="false"[^>]*aria-controls="menuList"/);
  assert.match(menu, /<ul id="menuList" class="menu-list" hidden>/);
  assert.match(menu, /href="about\.html">About</);
  assert.doesNotMatch(menu, />Help</, 'About and Help are one entry');
  assert.doesNotMatch(menu, /github\.com/, 'the GitHub link lives on the About page');
  assert.match(css, /\.menu\{[^}]*justify-content:flex-end/, 'pushed to the right');
  assert.match(css, /\.menu-list\{position:absolute;right:0/);
  assert.match(js, /aria-expanded/);
  assert.match(js, /e\.key === 'Escape'/);
  assert.match(js, /menuList\.contains\(e\.target\)/, 'a tap outside closes it');
});

test('the home page is roomy and plain: menu at the top, a large logo with space before the name, the radar, then one action', () => {
  const html = read('index.html'), css = read('style.css');
  assert.match(html, /<header class="top">\s*<nav class="menu"[\s\S]*<\/header>\s*<div class="intro">\s*<div class="brand big"><img class="logo logo-lg"[^>]*width="88" height="88"[^>]*>Far<b>Gems<\/b><\/div>/, 'menu on top, then the centred logo and name');
  assert.match(html, /<p class="lead">[\s\S]*<div class="hero-row">\s*<a id="heroLink" class="hero-link" href="viewer\.html"[^>]*aria-label="Open the sky view">\s*<svg class="hero"/, 'intro, then the radar, which is a link to the sky view');
  assert.ok(html.indexOf('class="hero-row"') < html.indexOf('id="openLink"') && html.indexOf('id="openLink"') < html.indexOf('id="permsCard"'), 'radar, then the launch button, then the permission card');
  assert.match(css, /\.logo-lg \{ display: block; margin: 0 auto 16px; \}/, 'space between the logo and the name');
  assert.match(css, /\.hero-row \.hero\{width:min\(52vw,190px\)\}/, 'the radar is a good size, not tiny');
  assert.match(css, /\.landing \.install\{display:grid;grid-template-columns:1fr auto/, 'install card is one short row');
  assert.match(css, /\.landing \.perm-state\{grid-row:1;grid-column:2\}/, 'each permission is name and state on one line');
});

test('the small links are tucked into the ... menu: Settings, About, install, sample location', () => {
  const menu = read('index.html').match(/<ul id="menuList"[\s\S]*?<\/ul>/)[0];
  for (const needle of ['href="about.html"', 'id="sampleBtn"', 'href="settings.html"', 'id="menuInstall"']) assert.ok(menu.includes(needle), needle);
  const body = read('index.html').split('</header>')[1];
  assert.doesNotMatch(body, /id="sampleBtn"/, 'not left lying in the page');
  assert.doesNotMatch(read('index.html'), /Change permissions|allowAgainBtn/, 'permissions are changed in Settings');
});

test('once permissions are granted the card is hidden and only the launch button (or the radar) remains', () => {
  const js = read('landing.js');
  assert.match(js, /els\.perms\.hidden = s\.phase === 'ready'/);
  assert.match(js, /els\.hero\.addEventListener\('click'/);
  assert.match(js, /phase === 'ask'\) \{ e\.preventDefault\(\); askPermissions\(\)/, 'before permissions the radar asks for them');
  assert.doesNotMatch(js, /phase !== 'ready'/, 'the install button no longer waits for setup');
  assert.match(js, /els\.sample\.parentElement\.hidden/);
});
