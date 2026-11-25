'use strict';
// Wide landscape screens (tablets): the pages use the width instead of scrolling; permission opens the sky view; the
// home page title is one a searcher would click; the radar's compass letters are never cut off.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const MEDIA = /@media \(min-width: 900px\) and \(min-aspect-ratio: 5\/4\) \{([\s\S]*?)\n\}/;

test('landscape tablets: the home page has two columns, intro and actions, filling the screen height', () => {
  const css = read('style.css').match(MEDIA)[1], html = read('index.html');
  assert.match(css, /\.landing \.welcome \{[^}]*display: grid; grid-template-columns: minmax\(0, 1fr\) minmax\(0, 420px\)[^}]*min-height: 100dvh/);
  const intro = html.indexOf('<div class="intro">'), actions = html.indexOf('<div class="actions">');
  assert.ok(intro > 0 && actions > intro, 'intro then actions');
  for (const id of ['heroLink', 'tagline']) assert.ok(id === 'tagline' ? html.indexOf('class="tagline"') > intro && html.indexOf('class="tagline"') < actions : html.indexOf(`id="${id}"`) > intro && html.indexOf(`id="${id}"`) < actions, id + ' is in the intro');
  for (const id of ['openLink', 'permsCard', 'manualForm', 'installCard']) assert.ok(html.indexOf(`id="${id}"`) > actions, id + ' is in the actions');
  assert.match(css, /\.landing \.welcome\.wide \{ display: block; max-width: 760px/, 'About is a single wider column');
  assert.match(read('about.html'), /<main class="welcome wide">/);
});

test('landscape tablets: the sky view puts radar, details and the nearby list side by side, with no page scroll', () => {
  const css = read('style.css').match(MEDIA)[1], html = read('viewer.html');
  assert.match(css, /body\.viewer \{ height: 100dvh; overflow: hidden;/);
  assert.match(css, /body\.viewer \.tabs, body\.viewer main > footer \{ display: none; \}/, 'no tabs: both lists are shown');
  assert.match(css, /transform: none !important/, 'no swiping between pages');
  assert.match(css, /--rs: min\(calc\(100dvh - 215px\), 640px, calc\(100vw - 420px\)\)/, 'the radar is sized by the screen height, and leaves room for the column beside it');
  assert.match(css, /#pageRadar > \.side \{ grid-column: 2; grid-row: 1 \/ -1;[^}]*display: flex; flex-direction: column/, 'one column beside the radar');
  assert.match(css, /body\.viewer \.side > #pageNearby \{ flex: 1; min-height: 0;[^}]*overflow-y: auto/, 'the nearby list fills the rest of the column and scrolls inside it');
  assert.match(read('app.js'), /const placeNearby = \(\) => \{ const to = wide\.matches \? document\.querySelector\('\.side'\) : \$\('#pager'\)/, 'the nearby list moves under the details on a wide screen');
  const side = html.match(/<div class="side">([\s\S]*?)<\/div>\s*<\/div>\s*<div class="page" id="pageNearby">/);
  assert.ok(side && side[1].includes('id="detail"') && side[1].includes('id="passes"'), 'detail and passes sit in the side column');
});

test('the wide layout never applies to phones in portrait', () => {
  const css = read('style.css');
  assert.match(css, /@media \(min-width: 900px\) and \(min-aspect-ratio: 5\/4\)/);
  assert.doesNotMatch(css.split('@media (min-width: 900px)')[0], /100dvh/, 'the base layout is not height-locked');
});

test('after permission is given the visitor goes straight to the sky view', () => {
  const js = read('landing.js');
  assert.match(js, /function openSkyView\(\) \{[\s\S]*location\.assign\('viewer\.html'\)/);
  assert.match(js, /render\(\);\s*if \(loc\) openSkyView\(\);/, 'after the permission prompts, when location was shared');
  assert.match(js, /render\(\);\s*openSkyView\(\);\s*\}\);/, 'after typing coordinates');
  assert.doesNotMatch(js.match(/\(async \(\) => \{[\s\S]*$/)[0], /openSkyView/, 'a quiet check on arrival does not move the visitor away');
});

test('the home page title and description are worth clicking, and the permission text is kept out of snippets', () => {
  const html = read('index.html');
  const title = html.match(/<title>([^<]+)/)[1];
  assert.equal(title, 'FarGems: Augmented Reality Sky Map of Planes, ISS and Satellites');
  assert.doesNotMatch(title, /allow|permission|compass/i);
  assert.ok(title.length <= 70);
  for (const tag of ['og:title', 'twitter:title']) assert.ok(html.includes(`"${tag}" content="${title}"`) || html.includes(`property="${tag}" content="${title}"`), tag);
  assert.match(html, /<section id="permsCard"[^>]*data-nosnippet/);
  assert.match(html, /<section id="installCard"[^>]*data-nosnippet/);
});

test('the radar letters N, E, S and W sit a fixed distance outside the rim, so a large radar does not cut them off', () => {
  const app = read('app.js');
  assert.match(app, /rl = R \+ 14, p = \{ x: cx \+ sgn \* rl \* Math\.sin\(th\)/);
  assert.doesNotMatch(app, /P\(az, -9\)/);
});

test('augmented reality is named where a search would find it: title, description, headline text, FAQ and structured data', () => {
  const home = read('index.html'), about = read('about.html');
  assert.match(home.match(/<title>([^<]+)/)[1], /Augmented Reality/);
  assert.match(home.match(/name="description" content="([^"]+)"/)[1], /augmented reality/);
  assert.match(home.match(/<p class="lead">([^<]+)/)[1], /augmented reality/);
  assert.match(home, /"featureList": \[[^\]]*Augmented reality camera view/);
  assert.match(about, /<dt>What is the AR view\?<\/dt><dd>Augmented reality shows/);
  assert.match(about, /"name": "What is the AR view\?"/, 'the structured data carries the same question');
  assert.match(about.match(/<h1[^>]*>[\s\S]*?<\/p>/)[0], /augmented reality \(AR\)/);
});

test('an iPad that reports itself as a Mac (iPadOS Safari) is still treated as an iPad for the install steps', () => {
  const js = read('landing.js');
  assert.match(js, /const ios = \/iphone\|ipad\|ipod\/i\.test\(navigator\.userAgent\) \|\| \(navigator\.platform === 'MacIntel' && navigator\.maxTouchPoints > 1\);/);
});
