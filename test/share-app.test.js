'use strict';
// Sharing the app itself: one short text that fits a WhatsApp message or a tweet, from the menus and the Settings page.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const O = require('../lib/onboarding.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('the share text is short enough for a tweet with the address, and says what the app does in one breath', () => {
  const d = O.appShare({ origin: 'https://fargems.example', pathname: '/viewer.html' });
  assert.ok(d.text.length <= 200, 'the text is ' + d.text.length + ' characters');
  assert.ok((d.text + ' ' + d.url).length <= 240, 'with the address it still fits 280 with room for a hashtag');
  assert.match(d.text, /^Try this: look up, then open FarGems\./, 'it opens by inviting the friend to try it, not with a slogan');
  for (const word of [/planes/, /ISS/, /planets/, /Moon/, /radar/, /camera/, /right now/, /Free, no sign-up/]) assert.match(d.text, word);
  assert.doesNotMatch(d.text, /\d+\.\d{2,}/, 'no coordinates');
  assert.doesNotMatch(d.text, /https?:/, 'the address is separate, so the share sheet can place it');
  assert.equal(O.SHARE_TEXT, d.text);
  assert.ok(d.title.length > 0 && d.title.length <= 60);
  assert.match(d.title, /what.s flying above you/, 'the same line as the loading screen');
  assert.doesNotMatch(d.text, /\bAR\b/, 'no jargon a friend would not know');
});

test('the shared address is the site itself, whichever page the button is on', () => {
  assert.equal(O.appShare({ origin: 'https://fargems.example', pathname: '/viewer.html' }).url, 'https://fargems.example/');
  assert.equal(O.appShare({ origin: 'https://fargems.example', pathname: '/' }).url, 'https://fargems.example/');
  assert.equal(O.appShare({ origin: 'https://user.github.io', pathname: '/fargems/settings.html' }).url, 'https://user.github.io/fargems/', 'also on a project address');
  assert.equal(O.appShare({ origin: 'http://localhost:8080', pathname: '/index.html' }).url, 'http://localhost:8080/');
  assert.equal(O.appShare(null).url, '/', 'nothing known: just the root');
});

test('shareApp uses the share sheet, else copies text and address, and tells a closed sheet from a failure', async () => {
  const location = { origin: 'https://fargems.example', pathname: '/settings.html' };
  const calls = [];
  assert.equal(await O.shareApp({ location, navigator: { share: async (d) => { calls.push(d); } } }), 'shared');
  assert.deepEqual(calls[0], { title: O.SHARE_TITLE, text: O.SHARE_TEXT, url: 'https://fargems.example/' });
  const copied = [];
  assert.equal(await O.shareApp({ location, navigator: { clipboard: { writeText: async (t) => { copied.push(t); } } } }), 'copied');
  assert.equal(copied[0], O.SHARE_TEXT + ' https://fargems.example/', 'the text and the address together');
  assert.equal(await O.shareApp({ location, navigator: { share: async () => { const e = new Error('closed'); e.name = 'AbortError'; throw e; }, clipboard: { writeText: async () => { throw new Error('must not copy'); } } } }), 'cancelled', 'closing the sheet is not an error and copies nothing');
  assert.equal(await O.shareApp({ location, navigator: { share: async () => { throw new Error('broken'); } } }), 'failed');
  assert.equal(await O.shareApp({ location, navigator: { clipboard: { writeText: async () => { throw new Error('denied'); } } } }), 'failed');
  assert.equal(await O.shareApp({ location, navigator: {} }), 'failed', 'neither a sheet nor a clipboard');
  assert.equal(await O.shareApp({}), 'failed');
  assert.equal(await O.shareApp(), 'failed');
});

test('Tell a friend is in the home menu, the sky view gear menu and the Settings page', () => {
  assert.match(read('index.html'), /<li><button id="menuShare" class="menu-item" type="button">Tell a friend<\/button><\/li>/);
  assert.match(read('viewer.html'), /<li><button id="gearShare" class="menu-item" type="button">Tell a friend<\/button><\/li>/);
  const s = read('settings.html');
  assert.match(s, /<section class="card" aria-labelledby="shareTitle">\s*<h2 id="shareTitle">Pass it on<\/h2>[\s\S]*?<button id="shareApp" class="btn wide" type="button">Tell a friend<\/button>/);
  assert.match(read('index.html'), /<div id="toast" class="toast" role="status" hidden><\/div>/, 'the home page can say it copied');
  for (const [f, id] of [['landing.js', 'menuShare'], ['app.js', 'gearShare'], ['settings.js', 'shareApp']]) assert.match(read(f), new RegExp("\\$\\('#" + id + "'\\)\\.addEventListener\\('click', async \\(\\) => \\{[\\s\\S]*?O\\.shareApp\\(\\{ navigator, location \\}\\)"), f);
  assert.match(read('settings.html'), /<script defer src="lib\/onboarding\.js">/, 'Settings loads the sharing code');
});
