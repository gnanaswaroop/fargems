'use strict';
// A tap is not lost when a card is rewritten between the press and the release (the browser test `a tap is not lost...` shows it
// in a real browser; this pins the rule in the code).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

test('a container is not rewritten while a press that began inside it is held, and the next refresh catches up', () => {
  assert.match(app, /document\.addEventListener\('pointerdown', \(e\) => \{ pressIn = e\.target; pressAt = Date\.now\(\); \}, true\);/);
  assert.match(app, /for \(const ev of \['pointerup', 'pointercancel'\]\) document\.addEventListener\(ev, \(\) => \{ pressIn = null; \}, true\);/, 'let go or cancelled: the press is over');
  const fn = app.slice(app.indexOf('function setHtml'), app.indexOf('function setHtml') + 600);
  assert.match(fn, /if \(pressIn && Date\.now\(\) - pressAt < 3000 && el\.contains\(pressIn\)\) return;/, 'skipped, not queued: the card refreshes every two seconds');
  assert.ok(fn.indexOf('el.__html === html') < fn.indexOf('pressIn'), 'nothing to do when the text is the same');
  assert.ok(fn.indexOf('pressIn') < fn.indexOf('el.innerHTML = html'), 'the check comes before the rewrite');
});

test('a press that was never let go (a lost event) does not freeze a card for ever', () => {
  assert.match(app, /Date\.now\(\) - pressAt < 3000/);
});
