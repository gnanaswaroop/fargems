'use strict';
// Satellites and space stations are drawn with the satellite emoji, on the radar and in the camera view, and the key shows it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../lib/logic.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('the satellite glyph is the satellite emoji, drawn in colour', () => {
  assert.equal(L.SAT_GLYPH, '\u{1F6F0}️');
  assert.match(L.SAT_GLYPH, /️$/, 'asks for the picture, not the flat symbol');
  assert.match(L.SAT_FONT, /Apple Color Emoji.*Segoe UI Emoji.*Noto Color Emoji/);
});

test('the radar and the camera view draw it, with sunlight, shadow and visibility shown without the old diamond', () => {
  const app = read('app.js'), ar = read('ar-view.js');
  assert.match(app, /ctx\.fillText\(window\.FarGemsLogic\.SAT_GLYPH, p\.x, p\.y\)/);
  assert.match(app, /ctx\.globalAlpha = o\.visible \|\| o\.sunlit \? 1 : 0\.4/, 'faded in shadow');
  assert.match(app, /if \(o\.visible\) \{ ctx\.shadowColor = '#fff'/, 'glow when visible');
  assert.match(app, /\(\(major \|\| o\.id === sel\) \? 22 : 14\) \+ 'px '/, 'stations and the pick are larger (the size is a number, not a boolean joined to the text)');
  assert.match(app, /ctx\.fillStyle = '#fff'; ctx\.globalAlpha = o\.visible/, 'a solid fill: an emoji is drawn at the fill opacity, and the last fill is nearly see-through');
  assert.match(ar, /ctx\.fillStyle = '#fff'; ctx\.font = \(isSel \? 32 : 26\)/);
  assert.match(ar, /ctx\.fillText\(L\.SAT_GLYPH, 0, 0\)/);
  assert.doesNotMatch(app.slice(app.indexOf('// satellites'), app.indexOf('// aircraft')), /ctx\.moveTo\(p\.x, p\.y - r\)/, 'no diamond on the radar');
});

test('the key shows the satellite emoji for satellites and for stations', () => {
  const v = read('viewer.html');
  assert.equal((v.match(/class="sym sat" aria-hidden="true">&#x1F6F0;&#xFE0F;/g) || []).length, 2);
  assert.match(v, /Full colour means sunlit, faded means in the Earth's shadow, and one with a white glow/);
});
