'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const AR = require('../lib/ar.js');

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} is not within ${eps} of ${b}`);
const VIEW = { W: 400, H: 800, vfov: 60 };

test('cameraPose: an upright phone looks at the horizon, a flat one looks down', () => {
  let p = AR.cameraPose(0, 90, 0);
  near(p.pitch, 0); near(p.heading, 0);
  p = AR.cameraPose(0, 0, 0);
  near(p.pitch, -90);
  p = AR.cameraPose(0, 120, 0); // tipped back 30 degrees, looking up
  near(p.pitch, 30); near(p.heading, 0);
});

test('cameraPose: turning the phone changes the heading', () => {
  near(AR.cameraPose(90, 90, 0).heading, 270, 1e-6); // turned counter-clockwise: faces west
  near(AR.cameraPose(270, 90, 0).heading, 90, 1e-6); // faces east
  near(AR.cameraPose(180, 90, 0).heading, 180, 1e-6);
});

test('projectToScreen: the point the camera looks at is the centre of the picture', () => {
  const p = AR.projectToScreen({ az: 120, el: 25 }, { heading: 120, pitch: 25 }, VIEW);
  assert.equal(p.front, true);
  near(p.x, 200, 1e-6); near(p.y, 400, 1e-6);
  assert.equal(p.onScreen, true);
});

test('projectToScreen: objects to the right are drawn right, objects above are drawn higher', () => {
  const pose = { heading: 0, pitch: 0 };
  const right = AR.projectToScreen({ az: 10, el: 0 }, pose, VIEW);
  const left = AR.projectToScreen({ az: 350, el: 0 }, pose, VIEW);
  const up = AR.projectToScreen({ az: 0, el: 10 }, pose, VIEW);
  assert.ok(right.x > 200 && left.x < 200);
  near(right.x - 200, 200 - left.x, 1e-6);
  assert.ok(up.y < 400);
});

test('projectToScreen: the vertical field of view maps to the screen height', () => {
  const top = AR.projectToScreen({ az: 0, el: 30 }, { heading: 0, pitch: 0 }, VIEW);
  near(top.y, 0, 1e-6); // half of 60 degrees is exactly the top edge
});

test('projectToScreen: things behind or far to the side are off screen', () => {
  const pose = { heading: 0, pitch: 0 };
  const behind = AR.projectToScreen({ az: 180, el: 0 }, pose, VIEW);
  assert.equal(behind.front, false);
  assert.equal(behind.onScreen, false);
  const side = AR.projectToScreen({ az: 80, el: 0 }, pose, VIEW);
  assert.equal(side.front, true);
  assert.equal(side.onScreen, false);
});

test('hfovFor is narrower than the vertical field on a portrait screen', () => {
  const h = AR.hfovFor(60, 400, 800);
  assert.ok(h < 60 && h > 30);
  near(AR.hfovFor(60, 800, 800), 60, 1e-9);
});

test('edgeIndicator points at off-screen targets from the screen edge', () => {
  const right = AR.edgeIndicator(1, 0, 400, 800, 20);
  near(right.x, 380); near(right.y, 400); near(right.angle, 0);
  const up = AR.edgeIndicator(0, 1, 400, 800, 20);
  near(up.x, 200); near(up.y, 20); near(up.angle, -Math.PI / 2);
  const behind = AR.edgeIndicator(0, -1, 400, 800, 20); // below and behind
  near(behind.y, 780);
  const diag = AR.edgeIndicator(1, 1, 400, 800, 20);
  assert.ok(diag.x <= 380 && diag.y >= 20 && diag.x >= 20 && diag.y <= 780);
});

test('wantsAR enters when the phone is raised and leaves when it is laid flat, with hysteresis', () => {
  assert.equal(AR.wantsAR(false, -80), false);
  assert.equal(AR.wantsAR(false, -40), false, 'not raised enough to switch on');
  assert.equal(AR.wantsAR(false, -30), false, 'phone tilted for reading stays in the radar');
  assert.equal(AR.wantsAR(false, -16), false);
  assert.equal(AR.wantsAR(false, -10), true);
  assert.equal(AR.wantsAR(true, -30), true, 'stays on between the two thresholds');
  assert.equal(AR.wantsAR(true, -70), false);
  assert.equal(AR.wantsAR(true, NaN), true, 'no reading keeps the current mode');
});

test('pickNearest chooses the closest item inside its tap radius', () => {
  const items = [{ id: 'a', x: 100, y: 100, r: 20 }, { id: 'b', x: 110, y: 100, r: 20 }, { id: 'c', x: 300, y: 300, r: 10 }];
  assert.equal(AR.pickNearest(items, 108, 100).id, 'b');
  assert.equal(AR.pickNearest(items, 200, 200), null);
  assert.equal(AR.pickNearest([], 1, 1), null);
});

test('chooseHeading prefers the compass reading, and smoothHeading takes the short way round', () => {
  assert.equal(AR.chooseHeading(123, 10), 123);
  assert.equal(AR.chooseHeading(null, 10), 10);
  assert.equal(AR.chooseHeading(undefined, 10), 10);
  near(AR.smoothHeading(350, 10, 0.5), 0, 1e-9);
  near(AR.smoothHeading(10, 350, 0.5), 0, 1e-9);
  assert.equal(AR.smoothHeading(null, 77), 77);
});

// ---- automatic open and close ----
const OK = { isOpen: false, opening: false, cameraGranted: true, compassOn: true, onRadarPage: true };
function run(steps, st = AR.newAutoState()) {
  const actions = [];
  for (const s of steps) { const r = AR.autoStep(st, { ...OK, ...s }); st = r.state; actions.push(r.action); }
  return { st, actions };
}

test('autoStep opens only after the phone has been held up steadily', () => {
  const { actions } = run([{ pitch: 0, now: 1000 }, { pitch: 0, now: 1300 }, { pitch: 0, now: 1800 }]);
  assert.deepEqual(actions, [null, null, 'open']);
});

test('autoStep does not open without the camera allowed, the compass on, or on the Nearby page', () => {
  for (const block of [{ cameraGranted: false }, { compassOn: false }, { onRadarPage: false }]) {
    const { actions } = run([{ pitch: 0, now: 1000 }, { pitch: 0, now: 2000 }].map((s) => ({ ...s, ...block })));
    assert.deepEqual(actions, [null, null], JSON.stringify(block));
  }
});

test('autoStep does not start a second attempt while one is opening or the view is open', () => {
  assert.deepEqual(run([{ pitch: 0, now: 1000 }, { pitch: 0, now: 2000, opening: true }]).actions, [null, null]);
  assert.deepEqual(run([{ pitch: 0, now: 1000 }, { pitch: 0, now: 2000, isOpen: true }]).actions, [null, null]);
});

test('after a failed attempt or a manual close it stays shut until the phone has been laid flat once', () => {
  let { st } = run([{ pitch: 0, now: 1000 }, { pitch: 0, now: 2000 }]);
  st = AR.suppress(st);
  // still held up for a long time: no repeated attempts
  const held = run([{ pitch: 0, now: 3000 }, { pitch: 0, now: 4000 }, { pitch: 0, now: 5000 }], st);
  assert.deepEqual(held.actions, [null, null, null]);
  // laid flat for a moment, then raised again: allowed once more
  const again = run([{ pitch: -80, now: 6000 }, { pitch: -80, now: 7000 }, { pitch: 0, now: 8000 }, { pitch: 0, now: 9000 }], held.st);
  assert.deepEqual(again.actions, [null, null, null, 'open']);
});

test('autoStep closes an open view once the phone has been flat for a moment, and ignores a closed one', () => {
  const open = { isOpen: true };
  const r = run([{ pitch: 0, now: 1000, ...open }, { pitch: -80, now: 2000, ...open }, { pitch: -80, now: 2300, ...open }, { pitch: -80, now: 2800, ...open }]);
  assert.deepEqual(r.actions, [null, null, null, 'close']);
  assert.deepEqual(run([{ pitch: -80, now: 1000 }, { pitch: -80, now: 3000 }]).actions, [null, null]);
});

test('the radar keeps north at the top with the compass on, and draws the facing wedge instead', () => {
  const app = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(app, /const rot = state\.compass \? 0 : state\.rot/);
  assert.doesNotMatch(app, /state\.compass \? state\.heading : state\.rot/);
  assert.match(app, /P\(state\.heading \+ d, 0\)/);
});
