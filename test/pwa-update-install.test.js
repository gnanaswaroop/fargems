'use strict';
// Noticing a newer version, the install button on the home page, and the AR / compass fixes that went with them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const U = require('../lib/update.js');
const AR = require('../lib/ar.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('update: a page is stale only when both build ids are known and they differ', () => {
  assert.equal(U.isStale('abc123', 'def456'), true);
  assert.equal(U.isStale('abc123', 'abc123'), false);
  assert.equal(U.isStale('', 'def456'), false, 'a local copy has no build id and never nags');
  assert.equal(U.isStale('abc123', ''), false, 'an unreadable answer is not a reason to nag');
  assert.equal(U.isStale(undefined, null), false);
  assert.equal(U.parseBuild(' 0a1b2c '), '0a1b2c');
  assert.equal(U.parseBuild('<script>'), '');
  assert.equal(U.parseBuild('x'.repeat(65)), '');
});

test('update: version.json is asked for with a changing query and not more than every five minutes', () => {
  assert.equal(U.versionUrl(1700000000123.9), 'version.json?t=1700000000123');
  assert.notEqual(U.versionUrl(1), U.versionUrl(2));
  assert.equal(U.shouldCheck(0, 1000), true);
  assert.equal(U.shouldCheck(1000, 1000 + 4 * 60e3), false);
  assert.equal(U.shouldCheck(1000, 1000 + 5 * 60e3), true);
});

test('update: the pages load the check, the deploy writes the build id twice, and the service worker leaves version.json alone', () => {
  for (const page of ['index.html', 'about.html', 'settings.html', 'viewer.html']) {
    const html = read(page);
    assert.match(html, /<script defer src="config\.js"><\/script>/, `${page} loads config.js (it carries the build id)`);
    assert.ok(html.indexOf('lib/update.js') < html.indexOf('src="update.js"'), `${page}: helpers before the glue`);
  }
  const wf = read('.github/workflows/pages.yml');
  assert.match(wf, /build: \\"\$GITHUB_SHA\\"/, 'config.js carries the commit');
  assert.match(wf, /\{"build":"%s"\}.*\$GITHUB_SHA.*_site\/version\.json/, 'version.json carries the same commit');
  assert.match(wf, /update\.js/, 'update.js is published');
  const sw = read('sw.js');
  assert.match(sw, /endsWith\('\/version\.json'\)\) return;/, 'version.json is never cached or served from the cache');
  assert.match(sw, /'update\.js'/);
  assert.match(sw, /VERSION = 'fargems-v3'/, 'a new service worker version so existing installs refresh');
  assert.match(read('config.js'), /aircraftProxy: ''/, 'no build id locally, so no nagging in development');
});

test('update: the glue offers Reload and Later, checks when the page is shown, and notices a replaced service worker', () => {
  const js = read('update.js');
  assert.match(js, /A new version of FarGems is available\./);
  assert.match(js, /textContent = 'Reload'/);
  assert.match(js, /textContent = 'Later'/);
  assert.match(js, /visibilitychange/);
  assert.match(js, /controllerchange/);
  assert.match(js, /hadController/, 'the first install is not announced as an update');
  assert.match(js, /cache: 'no-store'/);
  assert.match(read('style.css'), /\.update-bar\{position:fixed/);
});

test('install: the home page always has an Install app button (and a menu item), until the app is installed', () => {
  const html = read('index.html'), js = read('landing.js');
  assert.doesNotMatch(html.match(/<section id="installCard"[^>]*>/)[0], /hidden/, 'the card is not hidden by default');
  assert.doesNotMatch(html.match(/<button id="installBtn"[^>]*>/)[0], /hidden/, 'the button is not hidden');
  assert.match(html, /<button id="menuInstall"[^>]*>Install app<\/button>/);
  assert.match(js, /const gone = mode === 'hidden';/);
  assert.match(js, /deferredInstall\.prompt\(\)/, 'starts the browser install when it offers one');
  for (const mode of ['prompt', 'ios', 'manual']) assert.match(js, new RegExp(mode + ':'), `text for ${mode}`);
  assert.match(js, /Add to Home Screen/);
  assert.match(js, /Install app, or Add to Home screen/);
  assert.match(read('manifest.webmanifest'), /"id": "\.\/"/);
  assert.match(read('sw.js'), /addEventListener\('fetch'/, 'a service worker with a fetch handler (needed for install)');
});

test('home page: the launch button sits right under the radar, the menu button matches the page, permissions can be fetched quietly', () => {
  const html = read('index.html'), css = read('style.css'), js = read('landing.js');
  assert.ok(html.indexOf('class="hero-row"') < html.indexOf('id="openLink"') && html.indexOf('id="openLink"') < html.indexOf('id="permsCard"'), 'hero, then launch button, then the permission card');
  assert.match(css, /\.menu-btn\{[^}]*background:transparent/, 'menu button has the page background');
  assert.doesNotMatch(css, /\.menu-btn\{[^}]*background:var\(--card\)/);
  assert.match(js, /navigator\.permissions\.query\(\{ name: 'geolocation' \}\)/);
  assert.match(js, /p\.state !== 'granted'\) return;/, 'only when the browser already allows it');
});

test('AR: only a view that opened by itself closes by itself', () => {
  const flat = { pitch: -80, isOpen: true, opening: false, cameraGranted: true, compassOn: true, onRadarPage: true };
  const st = { want: true, since: 0, suppressed: false };
  const settle = (inp) => AR.autoStep(AR.autoStep(st, { ...inp, now: 1000 }).state, { ...inp, now: 2000 });
  assert.equal(settle({ ...flat, closeAllowed: true }).action, 'close', 'opened by itself: closes when laid flat');
  assert.equal(settle({ ...flat }).action, 'close', 'default (older callers) unchanged');
  assert.equal(settle({ ...flat, closeAllowed: false }).action, null, 'opened with the AR button: stays open');
  assert.equal(settle({ ...flat, closeAllowed: false, isOpen: false }).action, null);
});

test('AR button held low: the view the visitor opened is not closed again by the tilt rule', () => {
  const app = read('app.js');
  assert.match(app, /async function openAR\(source = 'manual'\)/);
  assert.match(app, /arState\.openedBy = source;/);
  assert.match(app, /if \(r\.action === 'close'\) \{ arView\.close\(\); arState\.openedBy = null; dropArEntry\(\); \}/);
});

test('compass: starts by itself where no permission is needed, and waits for a real reading so a computer keeps drag-to-rotate', () => {
  const app = read('app.js');
  assert.match(app, /shouldAutoEnableCompass\(localStorage, window\)\) startCompass\(O\.readCompass\(localStorage\) !== 'granted'\)/);
  assert.match(app, /function startCompass\(wait = false\)/);
  assert.match(app, /if \(wait\) \{ state\.compassPending = true; return; \}/);
  assert.match(app, /if \(state\.compassPending && !state\.compass\) \{ state\.compass = true; state\.compassPending = false;/);
});
