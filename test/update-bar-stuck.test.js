'use strict';
// The "new version available" bar must go away after a reload. It stayed on because the CDN kept answering with the old
// config.js (the build this page thinks it is) while version.json already named the new build. Two fixes: every script and
// stylesheet gets the build in its address, and a reload that did not help is not offered again.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const U = require('../lib/update.js');
const { stampHtml, stampSite } = require('../scripts/stamp.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('stamp: local scripts and stylesheets get ?v=<build>, CDN libraries and other links do not', () => {
  const html = '<link rel="stylesheet" href="style.css"><link rel="stylesheet" href="/style.css"><script src="config.js"></script>' +
    '<script src="lib/update.js"></script><script src="https://cdn.jsdelivr.net/npm/satellite.js@5.0.0/dist/satellite.min.js"></script>' +
    '<script src="//cdn.example/x.js"></script><a href="about.html">About</a><link rel="icon" href="icon.svg"><script src="a.js?x=1"></script>';
  const out = stampHtml(html, 'abc123');
  assert.match(out, /href="style\.css\?v=abc123"/);
  assert.match(out, /href="\/style\.css\?v=abc123"/);
  assert.match(out, /src="config\.js\?v=abc123"/);
  assert.match(out, /src="lib\/update\.js\?v=abc123"/);
  assert.match(out, /src="https:\/\/cdn\.jsdelivr\.net\/npm\/satellite\.js@5\.0\.0\/dist\/satellite\.min\.js"/);
  assert.match(out, /src="\/\/cdn\.example\/x\.js"/);
  assert.match(out, /href="about\.html"/);
  assert.match(out, /href="icon\.svg"/);
  assert.match(out, /src="a\.js\?x=1"/, 'an address that already has a query is left alone');
});

test('stamp: every page of the site is stamped, every local script and stylesheet of every page', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-stamp-'));
  const pages = ['index.html', 'about.html', '404.html', 'viewer.html', 'settings.html'];
  for (const f of pages) fs.copyFileSync(path.join(__dirname, '..', f), path.join(dir, f));
  assert.deepEqual(stampSite(dir, 'deadbeef').sort(), pages.slice().sort());
  for (const f of pages) {
    const html = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of html.matchAll(/\b(?:src|href)="([^"]+\.(?:js|css)(?:\?[^"]*)?)"/g)) {
      if (/^(https?:)?\/\//.test(m[1])) continue;
      assert.match(m[1], /\?v=deadbeef$/, `${f}: ${m[1]}`);
    }
  }
  assert.deepEqual(stampSite(dir, ''), [], 'no build id, nothing to stamp (a local copy)');
});

test('the deploy stamps the site with the commit it was built from', () => {
  const wf = read('.github/workflows/pages.yml');
  assert.match(wf, /node scripts\/stamp\.js _site "\$GITHUB_SHA"/);
  assert.ok(wf.indexOf('stamp.js') > wf.indexOf('seo.js'), 'after the pages are finished');
  assert.ok(wf.indexOf('stamp.js') > wf.indexOf('_site/config.js'), 'after config.js carries the commit');
});

test('a reload that did not help is not offered again', () => {
  assert.equal(U.alreadyTried('new', 'new'), true);
  assert.equal(U.alreadyTried('old', 'new'), false, 'a still newer build may be offered');
  assert.equal(U.alreadyTried('', 'new'), false);
  assert.equal(U.alreadyTried('new', ''), false);
});

// Runs update.js in a fake page: the page is built from `current`, the server says `latest`, and a tab session is shared
// between runs the way a reload keeps sessionStorage.
function run({ current, latest, session }) {
  const added = [];
  let reloads = 0;
  const body = { append: (el) => added.push(el) };
  const mk = (tag) => ({ tag, children: [], listeners: {}, setAttribute() {}, append(...c) { this.children.push(...c); }, remove() { this.removed = true; }, addEventListener(t, f) { this.listeners[t] = f; } });
  const ctx = {
    window: { FarGemsUpdate: U, FARGEMS_CONFIG: { build: current } },
    document: { body, hidden: false, createElement: mk, addEventListener() {} },
    navigator: { serviceWorker: { controller: null, addEventListener() {}, getRegistration: () => Promise.resolve(null) } },
    sessionStorage: { getItem: (k) => (k in session ? session[k] : null), setItem: (k, v) => { session[k] = String(v); } },
    location: { reload: () => { reloads++; } },
    fetch: async () => ({ ok: true, json: async () => ({ build: latest }) }),
    setInterval: () => 0, Date,
  };
  vm.runInNewContext(read('update.js'), ctx);
  return new Promise((r) => setTimeout(() => r({ added, reloads: () => reloads }), 20));
}

test('the bar shows when the page is old, and after Reload it does not come back even if the old files came back', async () => {
  const session = {};
  const first = await run({ current: 'old', latest: 'new', session });
  assert.equal(first.added.length, 1, 'the bar is shown');
  const reload = first.added[0].children.find((c) => c.tag === 'button' && c.textContent === 'Reload');
  reload.listeners.click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(first.reloads(), 1, 'Reload reloads the page');
  assert.equal(session['fg.reloadedFor'], 'new');
  const second = await run({ current: 'old', latest: 'new', session }); // the old config.js came back
  assert.equal(second.added.length, 0, 'no second nag for the same build');
  const third = await run({ current: 'old', latest: 'newer', session });
  assert.equal(third.added.length, 1, 'a newer deploy is offered again');
});

test('a page that is up to date, or a local copy without a build id, never shows the bar', async () => {
  assert.equal((await run({ current: 'new', latest: 'new', session: {} })).added.length, 0);
  assert.equal((await run({ current: '', latest: 'new', session: {} })).added.length, 0);
});
