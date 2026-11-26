'use strict';
// Scripts from a CDN are checked against a hash, and every page carries a Content-Security-Policy.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const PAGES = ['index.html', 'about.html', 'viewer.html', 'settings.html', '404.html'];

test('every script loaded from another site has an integrity hash', () => {
  for (const f of PAGES) {
    for (const m of read(f).matchAll(/<script\b[^>]*\bsrc="(https?:[^"]+)"[^>]*>/g)) {
      assert.match(m[0], /integrity="sha384-[A-Za-z0-9+/]{64}"/, f + ': ' + m[1]);
      assert.match(m[0], /crossorigin="anonymous"/, f + ': ' + m[1]);
      assert.match(m[1], /@\d+\.\d+\.\d+\//, 'a pinned version: ' + m[1]);
    }
  }
});

test('every page has a Content-Security-Policy that allows only its own scripts and the CDN', () => {
  for (const f of PAGES) {
    const html = read(f);
    const csp = (html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/) || [])[1];
    assert.ok(csp, f + ' has a policy');
    assert.match(csp, /script-src 'self' https:\/\/cdn\.jsdelivr\.net;/);
    assert.doesNotMatch(csp, /script-src[^;]*'unsafe-(inline|eval)'/, 'no inline or eval scripts');
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /base-uri 'self'/);
    assert.match(csp, /form-action 'self'/);
    assert.ok(!html.includes('<script') || html.indexOf('Content-Security-Policy') < html.indexOf('<script'), 'the policy comes before any script');
  }
});

test('the pages need nothing the policy blocks: no inline scripts, no inline event handlers', () => {
  for (const f of PAGES) {
    const html = read(f);
    for (const m of html.matchAll(/<script\b([^>]*)>/g)) assert.ok(/\bsrc="/.test(m[1]) || /type="application\/ld\+json"/.test(m[1]), f + ': ' + m[0]);
    assert.doesNotMatch(html, /\son[a-z]+="/, f + ' has an inline handler');
    assert.doesNotMatch(html, /javascript:/i, f);
  }
  for (const f of ['app.js', 'landing.js', 'settings.js', 'ar-view.js', 'nav.js', 'update.js']) assert.doesNotMatch(read(f), /\beval\(|new Function\(/, f);
});
