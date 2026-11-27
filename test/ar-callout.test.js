'use strict';
// The camera view shows the picked object's details in a bubble beside it, joined by a dotted line; the object's icon fades so it
// does not cover the real one; the full card comes only when asked for. And the station passes list shows only when there is a pass
// to look at soon.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const AR = require('../lib/ar.js');
const L = require('../lib/logic.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

/* ---- timing ---- */
test('the bubble comes in soon after the pick and the icon fades after a moment, not at once', () => {
  assert.deepEqual(AR.calloutPhase(0), { bubble: 0, icon: 1 });
  assert.equal(AR.calloutPhase(AR.CALLOUT_SHOW_MS).bubble, 0, 'not before its time');
  assert.ok(AR.calloutPhase(AR.CALLOUT_SHOW_MS + 150).bubble > 0.3 && AR.calloutPhase(AR.CALLOUT_SHOW_MS + 150).bubble < 0.7, 'fading in');
  assert.equal(AR.calloutPhase(1000).bubble, 1);
  assert.equal(AR.calloutPhase(AR.ICON_HOLD_MS).icon, 1, 'the icon is shown long enough to see what was picked');
  const half = AR.calloutPhase(AR.ICON_HOLD_MS + AR.ICON_FADE_MS / 2).icon;
  assert.ok(half > 0.4 && half < 0.6, 'fading out: ' + half);
  assert.equal(AR.calloutPhase(AR.ICON_HOLD_MS + AR.ICON_FADE_MS).icon, 0, 'and then gone');
  assert.equal(AR.calloutPhase(60000).icon, 0); assert.equal(AR.calloutPhase(60000).bubble, 1);
  assert.deepEqual(AR.calloutPhase(NaN), { bubble: 0, icon: 1 });
  assert.ok(AR.ICON_HOLD_MS >= 1000 && AR.ICON_HOLD_MS <= 3000, 'hold: ' + AR.ICON_HOLD_MS);
});

/* ---- where it goes ---- */
const B = { left: 8, top: 100, right: 392, bottom: 650 };
test('the bubble goes above and to the right of the object when there is room, and otherwise the nearest corner that fits', () => {
  const up = AR.placeCallout(200, 400, 160, 70, B);
  assert.equal(up.side, 'up-right'); assert.ok(up.x > 200 && up.y + up.h < 400, 'above and right: ' + JSON.stringify(up));
  assert.equal(AR.placeCallout(350, 400, 160, 70, B).side, 'up-left', 'no room on the right');
  assert.equal(AR.placeCallout(200, 120, 160, 70, B).side, 'down-right', 'no room above');
  assert.equal(AR.placeCallout(380, 120, 160, 70, B).side, 'down-left', 'no room above or on the right');
});

test('the bubble never leaves the room it is given, and never sits on the object', () => {
  for (const [x, y] of [[0, 0], [400, 0], [0, 800], [400, 800], [200, 400], [10, 380], [390, 380], [200, 105], [200, 640]]) {
    const b = AR.placeCallout(x, y, 160, 70, B);
    assert.ok(b.x >= B.left && b.x + b.w <= B.right && b.y >= B.top && b.y + b.h <= B.bottom, `inside for (${x}, ${y}): ${JSON.stringify(b)}`);
  }
  for (const [x, y] of [[200, 400], [350, 400], [200, 120], [380, 120]]) {
    const b = AR.placeCallout(x, y, 160, 70, B);
    const d = Math.hypot(Math.max(b.x, Math.min(x, b.x + b.w)) - x, Math.max(b.y, Math.min(y, b.y + b.h)) - y);
    assert.ok(d > AR.RING_R, `clear of the ring for (${x}, ${y}): ${d}`);
  }
  const tight = AR.placeCallout(200, 300, 500, 70, B);
  assert.ok(tight.x >= B.left, 'a bubble wider than the room is pushed to the edge, not off the screen');
});

test('the bubble goes round a neighbouring object instead of covering it', () => {
  const free = AR.placeCallout(200, 400, 160, 70, B);
  assert.equal(free.side, 'up-right');
  // another object sits where the bubble would have gone: the next corner that is clear is used
  const neighbour = { x: free.x + free.w / 2, y: free.y + free.h / 2, r: 26 };
  const moved = AR.placeCallout(200, 400, 160, 70, B, undefined, [neighbour]);
  assert.notEqual(moved.side, 'up-right', 'moved: ' + moved.side);
  const gap = Math.hypot(Math.max(moved.x, Math.min(neighbour.x, moved.x + moved.w)) - neighbour.x, Math.max(moved.y, Math.min(neighbour.y, moved.y + moved.h)) - neighbour.y);
  assert.ok(gap >= 26, 'clear of the neighbour: ' + gap);
  // an object that is elsewhere changes nothing, and bad entries are ignored
  assert.deepEqual(AR.placeCallout(200, 400, 160, 70, B, undefined, [{ x: 20, y: 640, r: 26 }, null, { x: NaN, y: 1 }]), free);
  // when every corner has a neighbour the one with the fewest is used, and it still stays inside
  const around = [[260, 330], [140, 330], [260, 470], [140, 470]].map(([x, y]) => ({ x, y, r: 26 }));
  const crowded = AR.placeCallout(200, 400, 160, 70, B, undefined, around);
  assert.ok(crowded.x >= B.left && crowded.x + crowded.w <= B.right && crowded.y >= B.top && crowded.y + crowded.h <= B.bottom, 'inside: ' + JSON.stringify(crowded));
});

test('the dotted pointer runs from the ring to the nearest point of the bubble', () => {
  const box = { x: 218, y: 200, w: 160, h: 70 };
  const l = AR.calloutLeader(200, 300, box);
  assert.ok(Math.abs(Math.hypot(l.x1 - 200, l.y1 - 300) - AR.RING_R) < 1e-6, 'it starts on the ring');
  assert.deepEqual([l.x2, l.y2], [218, 270], 'and ends on the bubble, at its nearest corner');
  const below = AR.calloutLeader(300, 400, { x: 250, y: 200, w: 160, h: 70 });
  assert.equal(below.x2, 300, 'straight up to the underside when the object is under the bubble'); assert.equal(below.y2, 270);
  assert.equal(AR.calloutLeader(230, 235, box), null, 'nothing to draw when the bubble is on the ring');
});

/* ---- what it says ---- */
test('the bubble says what the object is and a few facts, in four lines at most', () => {
  const plane = L.arCalloutLines({ kind: 'air', name: 'AIC144', az: 200, el: 31, range: 12, altFt: 12000, ac: { type: 'B77W', gs: 400, call: 'AIC144' } }, { units: 'imperial' });
  assert.deepEqual(plane, ['AIC144 · B77W', 'Air India', '12,000 ft · 460 mph', '7 mi away']);
  const moon = L.arCalloutLines({ kind: 'body', name: 'Moon', az: 68, el: 49, phase: 0.35, distKm: 384400 }, { units: 'metric', far: 'km' });
  assert.equal(moon[0], 'Moon'); assert.equal(moon[1], '35% lit'); assert.match(moon[2], /384,400 km · light takes 1\.3 s/); assert.equal(moon[3], '49° up · ENE');
  const iss = L.arCalloutLines({ kind: 'sat', name: 'ISS (ZARYA)', az: 90, el: 40, altKm: 420, range: 600, visible: true }, { units: 'metric' });
  assert.deepEqual(iss, ['ISS (ZARYA)', 'Space station', 'Altitude 420 km · 600 km away', 'Sunlit, visible to the eye']);
  assert.deepEqual(L.arCalloutLines({ kind: 'star', name: 'Vega', az: 10, el: 60 }), ['Vega', 'Star', '60° up · N']);
  assert.match(L.arCalloutLines({ kind: 'met', name: 'Perseids', az: 40, el: 30, shower: { zhr: 100 } })[2], /~100\/hour/);
  assert.match(L.arCalloutLines({ kind: 'body', name: 'Saturn', az: 120, el: 35, mag: 0.9, distKm: 1.4e9 }, { units: 'metric', far: 'au' })[1], /Planet · magnitude 0\.9/);
  for (const o of [{ kind: 'air', name: 'X' }, { kind: 'sat', name: 'Y' }, { kind: 'body', name: 'Sun', az: 1, el: 1 }, null]) assert.ok(L.arCalloutLines(o).length <= 4);
  assert.deepEqual(L.arCalloutLines(null), []);
  const bare = L.arCalloutLines({ kind: 'air', name: 'ZZ9' });
  assert.deepEqual(bare, ['ZZ9'], 'missing facts are left out, not shown as blanks');
});

/* ---- the camera view with a clock the test controls ---- */
function viewEnv(objects, { selected = () => null, lines = (ob) => [ob.name, 'one', 'two'], withLines = true, symbols } = {}) {
  let now = 5000, cb = null, alpha = 1;
  const calls = [], classes = new Set(), saved = []; // save() and restore() keep the alpha, as a real canvas does
  const ctx = new Proxy({}, {
    get: (t, k) => (k === 'globalAlpha' ? alpha : k in t ? t[k] : (...a) => { if (k === 'save') saved.push(alpha); if (k === 'restore' && saved.length) alpha = saved.pop(); calls.push({ k, a, alpha, dash: t._dash }); if (k === 'setLineDash') t._dash = a[0]; return { width: 10 }; }),
    set: (t, k, v) => { if (k === 'globalAlpha') alpha = v; else t[k] = v; return true; },
  });
  const canvas = { width: 0, height: 0, clientWidth: 400, clientHeight: 800, getContext: () => ctx, addEventListener(n, f) { (canvas.l = canvas.l || {})[n] = f; }, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  const g = {
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } },
    document: { body: { classList: { add() {}, remove() {} } } },
    requestAnimationFrame: (f) => { cb = f; return 1; }, cancelAnimationFrame() {}, performance: { now: () => now }, devicePixelRatio: 1, console,
  };
  g.self = g; g.globalThis = g; vm.createContext(g);
  for (const f of ['lib/logic.js', 'lib/ar.js', 'ar-view.js']) vm.runInContext(read(f), g, { filename: f });
  const picked = [], ori = { alpha: 0, beta: 90, gamma: 0, compassHeading: 0, absolute: true };
  let sel = null;
  const opts = {
    root: { hidden: true, classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) } },
    video: { srcObject: null, play: async () => {} }, canvas, closeBtn: { addEventListener() {} },
    getObjects: () => objects, getFilters: () => ({ air: true, sat: true, sky: true, met: true, star: true, labels: true }), getSelected: () => sel,
    getOrientation: () => ori, onSelect: (id) => { picked.push(id); }, onClose() {},
  };
  if (withLines) opts.getCalloutLines = lines;
  if (symbols) opts.getSymbols = symbols;
  const view = g.FarGemsARView.create(opts);
  const run = (ms) => { for (let t = 0; t < ms; t += 16) { now += 16; if (cb) cb(); } };
  const tap = (x, y) => { canvas.l.pointerup({ clientX: x, clientY: y }); };
  return { view, calls, classes, run, ori, tap, select: (id) => { sel = id; }, picked, texts: () => calls.filter((c) => c.k === 'fillText').map((c) => c.a[0]) };
}
const moon = (az, el) => ({ id: 'body:Moon', kind: 'body', name: 'Moon', az, el, color: '#e6ecf5', phase: 0.5 });

test('picking an object: the details come in a bubble beside it and the card stays away', async () => {
  const e = viewEnv([moon(10, 12)]); // up and to the right of the crosshair, not at it, so the crosshair does not pick it
  await e.view.open(); e.run(200);
  assert.equal(e.view.callout(), null, 'nothing picked, no bubble');
  assert.equal(e.view.cardShown(), true, 'with nothing picked the card shows as before');
  e.select('body:Moon'); e.run(100);
  assert.equal(e.view.cardShown(), false, 'the card goes at once, the details are about to be in the bubble');
  assert.equal(e.texts().includes('one'), false, 'the bubble is not there in the first moments');
  e.run(500);
  assert.ok(e.view.callout(), 'the bubble is placed');
  assert.deepEqual(['Moon', 'one', 'two', 'More ›'].filter((t) => !e.texts().includes(t)), [], 'its lines and the way to more are drawn');
  const b = e.view.callout(); assert.ok(b.x >= 8 && b.x + b.w <= 392, 'inside the picture');
});

test('the picked object icon STAYS (it must not fade away while drawn symbols are on) and a ring of dots goes round it', async () => {
  const e = viewEnv([moon(10, 12)]);
  await e.view.open(); e.select('body:Moon'); e.run(300);
  const ring = () => e.calls.filter((c) => c.k === 'arc' && c.a[2] === AR.RING_R);
  assert.ok(ring().length > 0, 'the ring is drawn');
  assert.ok(e.calls.some((c) => c.k === 'setLineDash' && c.a[0][0] < 1 && c.a[0][1] >= 4), 'as dots (a dash that is a point, then a gap)');
  const icon = () => e.calls.filter((c) => c.k === 'arc' && c.a[2] === 11); // the Moon's icon in this test (no Moon drawing is loaded)
  e.calls.length = 0; e.run(32);
  assert.ok(icon().length > 0 && icon().every((c) => c.alpha === 1), 'the icon is whole at first: ' + icon().map((c) => c.alpha));
  for (const ms of [1800, 4000, 12000]) { e.run(ms); e.calls.length = 0; e.run(32); assert.ok(icon().length > 0 && icon().every((c) => c.alpha === 1), 'still whole after a long time: ' + icon().map((c) => c.alpha)); }
  assert.ok(ring().length > 0, 'the ring of dots is still there');
  assert.ok(e.calls.some((c) => c.k === 'lineTo'), 'and so is the dotted pointer to the bubble');
});

test('the name is written once for the picked object: in the bubble, not also beside the icon', async () => {
  const e = viewEnv([moon(10, 12)]);
  await e.view.open(); e.select('body:Moon'); e.run(900);
  e.calls.length = 0; e.run(16);
  assert.equal(e.calls.filter((c) => c.k === 'fillText' && c.a[0] === 'Moon').length, 1, 'once a frame');
});

test('tapping the bubble brings the full card, tapping it again takes it away, and a new pick starts with the bubble again', async () => {
  const e = viewEnv([moon(10, 12), { id: 'body:Mars', kind: 'body', name: 'Mars', az: 350, el: 10, color: '#d66' }]);
  await e.view.open(); e.select('body:Moon'); e.run(700);
  const b = e.view.callout();
  e.tap(b.x + b.w / 2, b.y + b.h / 2); e.run(32);
  assert.equal(e.picked.length, 0, 'a tap on the bubble does not pick anything');
  assert.equal(e.view.cardShown(), true, 'the card is up');
  assert.ok(e.view.callout(), 'with the bubble still showing');
  e.tap(b.x + b.w / 2, b.y + b.h / 2); e.run(32);
  assert.equal(e.view.cardShown(), false, 'and away again');
  e.tap(b.x + b.w / 2, b.y + b.h / 2); e.run(32); assert.equal(e.view.cardShown(), true);
  e.select('body:Mars'); e.run(100);
  assert.equal(e.view.cardShown(), false, 'another object: back to the bubble, the card closed');
});

test('when the picked object is out of the picture there is no bubble, so the card is shown instead', async () => {
  const e = viewEnv([moon(180, 12)]); // behind the phone
  await e.view.open(); e.select('body:Moon'); e.run(900);
  assert.equal(e.view.callout(), null); assert.equal(e.view.cardShown(), true);
});

test('without lines for the bubble the view works as before: ring, label and the card', async () => {
  const e = viewEnv([moon(10, 12)], { withLines: false });
  await e.view.open(); e.select('body:Moon'); e.run(2500);
  assert.equal(e.view.callout(), null); assert.equal(e.view.cardShown(), true);
  assert.ok(e.texts().includes('Moon'), 'the name is labelled beside the icon');
});

/* ---- the page ---- */
test('the card is hidden in the camera view unless asked for, and the app gives the view the lines for the bubble', () => {
  assert.match(read('style.css'), /\.ar:not\(\.ar-card\) \.ar-detail \{ display: none; \}/);
  assert.match(read('app.js'), /getCalloutLines: \(ob\) => window\.FarGemsLogic\.arCalloutLines\(ob, \{ units: state\.units, far: state\.far \}\)/);
  assert.match(read('ar-view.js'), /showCard\(cardOpen \|\| !selDraw\)/);
  assert.match(read('ar-view.js'), /o\.root\.classList\.add\('ar-card'\)/, 'opens with the card showing, until the first frame decides');
});

/* ---- station passes ---- */
const H = 3600e3;
test('station passes are shown when one is under way or starts within a few hours, and hidden otherwise', () => {
  const now = 1e12, p = (s, e) => ({ name: 'ISS', start: now + s, end: e == null ? undefined : now + e });
  assert.equal(L.passesSoon([p(-2 * 60e3, 4 * 60e3)], now).length, 1, 'under way');
  assert.equal(L.passesSoon([p(30 * 60e3, 36 * 60e3)], now).length, 1, 'in half an hour');
  assert.equal(L.passesSoon([p(3.9 * H, 3.95 * H)], now).length, 1, 'nearly four hours away');
  assert.equal(L.passesSoon([p(4.1 * H, 4.2 * H)], now).length, 0, 'more than four hours away');
  assert.equal(L.passesSoon([p(20 * H, 20.1 * H)], now).length, 0, 'tomorrow');
  assert.equal(L.passesSoon([p(-20 * 60e3, -10 * 60e3)], now).length, 0, 'already over');
  assert.equal(L.passesSoon([p(-60e3)], now).length, 1, 'under way with no end found yet');
  const two = [p(1 * H, 1.1 * H), Object.assign(p(9 * H, 9.1 * H), { name: 'Tiangong' })];
  assert.deepEqual(L.passesSoon(two, now).map((x) => x.name), ['ISS'], 'each pass on its own: the far one is dropped, the near one kept');
  for (const bad of [null, undefined, [], [null], [{}], 'x']) assert.deepEqual(L.passesSoon(bad, now), []);
});

test('the passes list uses it, and is hidden when nothing is left', () => {
  const app = read('app.js');
  assert.match(app, /const soon = window\.FarGemsLogic\.passesSoon\(state\.passes, Date\.now\(\)\);\r?\n\s*if \(!soon\.length\) \{ el\.hidden = true; return; \}/);
  assert.match(app, /if \(!soon\.includes\(p\)\) return '';/, 'a far pass is not listed, and the buttons keep their numbers');
});

/* ---- the switch for the drawn symbols (settings: "Hide virtual objects when the real object is shown in the AR view") ---- */
test('the setting is on unless the visitor turned it off, and it is in settings and read by the app', () => {
  assert.equal(L.parseArSymbols(null), true); assert.equal(L.parseArSymbols('1'), true); assert.equal(L.parseArSymbols('0'), false);
  assert.match(read('settings.html'), /<input id="arSymbolsToggle" type="checkbox"> Hide virtual objects when the real object is shown in the AR view/);
  assert.match(read('settings.js'), /storage\.setItem\('fg\.arSymbols', e\.target\.checked \? '0' : '1'\)/);
  assert.match(read('app.js'), /getSymbols: \(\) => window\.FarGemsLogic\.parseArSymbols\(storedValue\('fg\.arSymbols'\)\)/);
});

test('symbols off: no icon and no name is drawn over the objects, but the ring and the bubble stay and the crosshair still picks', async () => {
  const plane = { id: 'air:a1', kind: 'air', name: 'AIC144', az: 10, el: 12, course: false, ac: { type: 'B77W' } };
  const star = { id: 'star:Vega', kind: 'body', name: 'Vega', az: -8, el: 15, color: '#fff' };
  let on = true;
  const e = viewEnv([plane, star], { symbols: () => on });
  await e.view.open(); e.run(200);
  const dots = () => e.calls.filter((c) => c.k === 'arc' && c.a[2] > 4 && c.a[2] < 14).length;
  const before = dots(); assert.ok(before > 0, 'the symbols are drawn by default');
  assert.ok(e.texts().includes('Vega'), 'and so are the names');
  e.calls.length = 0; on = false; e.run(200);
  assert.equal(dots(), 0, 'off: no symbol');
  assert.ok(!e.texts().includes('Vega'), 'off: no name');
  assert.ok(e.view.item('air:a1') && e.view.item('star:Vega'), 'still there to be picked by the crosshair and by a tap');
  e.select('air:a1'); e.calls.length = 0; e.run(3000);
  assert.ok(e.calls.some((c) => c.k === 'setLineDash' && c.a[0] && c.a[0][0] === 0.1), 'the dotted ring goes round the real object');
  assert.ok(e.view.callout(), 'and the details are beside it');
  assert.equal(dots(), 0, 'with no symbol drawn');
});

test('a picked flight and a picked planet keep their icons too, for as long as they stay picked', async () => {
  for (const [ob, glyph] of [[{ id: 'air:z', kind: 'air', name: 'AIC144', az: 10, el: 12, course: false }, 'arc'], [{ id: 'body:Mars', kind: 'body', name: 'Mars', az: 10, el: 12, color: '#f66' }, 'arc']]) {
    const e = viewEnv([ob]);
    await e.view.open(); e.select(ob.id); e.run(300);
    for (const ms of [200, 3000, 10000]) { e.run(ms); e.calls.length = 0; e.run(32); const dots = e.calls.filter((c) => c.k === 'arc' && c.a[2] > 4 && c.a[2] < 14); assert.ok(dots.length > 0 && dots.every((c) => c.alpha === 1), ob.id + ' icon whole after ' + ms + ' ms'); }
  }
});
