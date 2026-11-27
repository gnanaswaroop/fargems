'use strict';
// The Sun, Moon and planets on the radar: a plain disc each, the Moon in its phase, Saturn with its rings, Jupiter with faint bands.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const BA = require('../lib/bodyart.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

// A canvas that records what is drawn.
function rec() {
  const calls = [];
  const c = { calls, fillStyle: '', strokeStyle: '', lineWidth: 1, shadowBlur: 0, shadowColor: '' };
  for (const m of ['save', 'restore', 'translate', 'rotate', 'beginPath', 'closePath', 'clip', 'moveTo', 'lineTo']) c[m] = (...a) => calls.push([m, ...a]);
  for (const m of ['arc', 'ellipse', 'fill', 'stroke']) c[m] = (...a) => calls.push([m, ...a, c.fillStyle, c.strokeStyle]);
  return c;
}
const body = (name, extra) => Object.assign({ id: 'body:' + name, kind: 'body', name, color: '#e8d08a' }, extra);

test('Saturn has rings: an ellipse wider than the planet, drawn behind and in front of it', () => {
  const c = rec(); BA.draw(c, body('Saturn'), 50, 60, 4, 0, '#000');
  const el = c.calls.filter((x) => x[0] === 'ellipse');
  assert.equal(el.length, 2, 'the far half and the near half');
  for (const e of el) { assert.ok(e[3] > 4 * 1.5, 'wider than the disc'); assert.ok(e[4] < e[3], 'seen at a slant, so flatter than wide'); }
  const order = c.calls.map((x) => x[0] + (x[0] === 'arc' ? ':' + x[3] : ''));
  const disc = order.indexOf('arc:4');
  assert.ok(c.calls.findIndex((x) => x[0] === 'ellipse') < disc && c.calls.map((x) => x[0]).lastIndexOf('ellipse') > disc, 'one half behind the disc, one in front');
  assert.equal(BA.extent('Saturn', 4) > 4 * 1.5, true, 'its name is kept clear of the rings');
  assert.equal(BA.extent('Mars', 4), 4);
});

test('other planets are plain discs, with no rings; Jupiter has two faint bands', () => {
  for (const n of ['Mercury', 'Venus', 'Mars', 'Uranus', 'Neptune', 'Sun']) {
    const c = rec(); BA.draw(c, body(n), 0, 0, 4, 0, '#000');
    assert.equal(c.calls.filter((x) => x[0] === 'ellipse').length, 0, n);
    assert.equal(c.calls.filter((x) => x[0] === 'arc').length >= 1, true);
  }
  const j = rec(); BA.draw(j, body('Jupiter'), 0, 0, 5, 0, null);
  assert.equal(j.calls.filter((x) => x[0] === 'lineTo').length, 2, 'two bands');
  assert.ok(j.calls.some((x) => x[0] === 'clip'), 'kept inside the disc');
});

test('the Moon is only its phase: lit part toward the Sun, no seas or craters', () => {
  const full = rec(); BA.draw(full, body('Moon', { phase: 1 }), 0, 0, 8, 0, null);
  const neu = rec(); BA.draw(neu, body('Moon', { phase: 0 }), 0, 0, 8, 0, null);
  assert.equal(neu.calls.some((x) => x[0] === 'ellipse'), false, 'a new Moon has no lit part');
  assert.ok(full.calls.some((x) => x[0] === 'ellipse'), 'a full Moon has the lit outline');
  const rot = (c) => c.calls.filter((x) => x[0] === 'rotate').map((x) => x[1]);
  const half = rec(); BA.draw(half, body('Moon', { phase: 0.5 }), 0, 0, 8, Math.PI, null);
  assert.deepEqual(rot(half), [Math.PI], 'turned to face the Sun');
  assert.equal(BA.drawMoon.length >= 5, true);
  assert.ok(!BA.MARIA, 'no sea patches on the radar Moon');
  for (const c of [full, half]) assert.equal(c.calls.filter((x) => x[0] === 'arc').length <= 4, true, 'a disc and its edge, nothing fancier');
});

test('a lit part of 0.5 is a half disc: the edge runs straight down the middle', () => {
  const c = rec(); BA.draw(c, body('Moon', { phase: 0.5 }), 0, 0, 8, 0, null);
  const e = c.calls.find((x) => x[0] === 'ellipse'); assert.ok(e[3] < 0.01, 'the terminator has no width at half');
});

test('planet sizes: brighter is bigger within a small range, and Saturn is never too small for its rings', () => {
  assert.ok(BA.planetRadius('Venus', -4.2) > BA.planetRadius('Mars', 1.5));
  assert.ok(BA.planetRadius('Saturn', 2) >= 3.5);
  assert.equal(BA.planetRadius('Neptune', 8), 2.5);
  assert.equal(BA.planetRadius('Venus', null) > 0, true);
});

test('the radar uses it, the page loads it in time, and the offline list has it', () => {
  const app = read('app.js'), v = read('viewer.html');
  assert.match(app, /BA\.draw\(ctx, o, p\.x, p\.y, r, sunAngle, look\.dotOutline\)/);
  assert.match(app, /Math\.atan2\(sp\.y - p\.y, sp\.x - p\.x\)/, 'the lit side faces the Sun on the dial');
  assert.ok(v.indexOf('lib/moon.js') < v.indexOf('lib/bodyart.js') && v.indexOf('lib/bodyart.js') < v.indexOf('src="app.js"'));
  assert.match(read('sw.js'), /'lib\/bodyart\.js'/);
});
