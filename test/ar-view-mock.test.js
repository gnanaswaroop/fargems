'use strict';
// Runs ar-view.js against a mocked camera, canvas and page, so camera handling is tested without a real device.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makeEnv({ getUserMedia }) {
  const stopped = [];
  const track = { stop: () => stopped.push(1) };
  const classes = new Set();
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => ({ width: 10 })), set: (t, k, v) => { t[k] = v; return true; } });
  const listeners = {};
  const canvas = { width: 0, height: 0, clientWidth: 390, clientHeight: 800, getContext: () => ctx, addEventListener: (n, f) => { listeners[n] = f; }, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  const video = { srcObject: null, play: async () => {} };
  const root = { hidden: true };
  const closeBtn = { addEventListener: (n, f) => { listeners['close:' + n] = f; } };
  let frames = 0;
  const g = {
    navigator: { mediaDevices: getUserMedia ? { getUserMedia: async (c) => { g.lastConstraints = c; return getUserMedia({ getTracks: () => [track] }); } } : undefined },
    document: { body: { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) } } },
    requestAnimationFrame: () => ++frames, cancelAnimationFrame: () => {},
    devicePixelRatio: 2, console,
  };
  g.self = g; g.globalThis = g;
  vm.createContext(g);
  for (const f of ['lib/logic.js', 'lib/ar.js', 'ar-view.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), g, { filename: f });
  const selected = [];
  const view = g.FarGemsARView.create({
    root, video, canvas, closeBtn,
    getObjects: () => [], getFilters: () => ({ air: true, sat: true, sky: true, labels: true }), getSelected: () => null,
    getOrientation: () => ({ alpha: 0, beta: 100, gamma: 0, absolute: true }), onSelect: (id) => selected.push(id), onClose: () => selected.push('closed'),
  });
  return { view, root, video, classes, stopped, listeners, selected, g, frames: () => frames };
}

test('open starts the back camera without audio, shows the overlay and starts drawing', async () => {
  const e = makeEnv({ getUserMedia: async (s) => s });
  await e.view.open();
  assert.equal(e.view.isOpen(), true);
  assert.equal(e.root.hidden, false);
  assert.ok(e.classes.has('ar-on'));
  assert.equal(e.g.lastConstraints.audio, false);
  assert.deepEqual(JSON.parse(JSON.stringify(e.g.lastConstraints.video)), { facingMode: { ideal: 'environment' } });
  assert.ok(e.video.srcObject, 'the stream is attached to the video');
  assert.ok(e.frames() >= 1);
});

test('close stops every camera track and hides the overlay', async () => {
  const e = makeEnv({ getUserMedia: async (s) => s });
  await e.view.open();
  e.view.close();
  assert.equal(e.view.isOpen(), false);
  assert.equal(e.stopped.length, 1);
  assert.equal(e.video.srcObject, null);
  assert.equal(e.root.hidden, true);
  assert.ok(!e.classes.has('ar-on'));
  e.view.close(); // closing twice is harmless
  assert.equal(e.stopped.length, 1);
});

test('a refused camera rejects with code "denied" and leaves the view closed', async () => {
  const e = makeEnv({ getUserMedia: async () => { const x = new Error('no'); x.name = 'NotAllowedError'; throw x; } });
  await assert.rejects(e.view.open(), (err) => err.code === 'denied');
  assert.equal(e.view.isOpen(), false);
  assert.equal(e.root.hidden, true);
});

test('a missing or broken camera gives "unsupported" or "failed"', async () => {
  const none = makeEnv({ getUserMedia: null });
  await assert.rejects(none.view.open(), (err) => err.code === 'unsupported');
  const busy = makeEnv({ getUserMedia: async () => { const x = new Error('in use'); x.name = 'NotReadableError'; throw x; } });
  await assert.rejects(busy.view.open(), (err) => err.code === 'failed');
});

test('opening twice does not ask for a second camera stream', async () => {
  let calls = 0;
  const e = makeEnv({ getUserMedia: async (s) => { calls++; return s; } });
  await e.view.open();
  await e.view.open();
  assert.equal(calls, 1);
});

test('the close button closes the view and tells the app; a tap on empty sky clears the selection', async () => {
  const e = makeEnv({ getUserMedia: async (s) => s });
  await e.view.open();
  e.listeners.pointerup({ clientX: 50, clientY: 50 });
  assert.deepEqual(e.selected, [null]);
  e.listeners['close:click']();
  assert.equal(e.view.isOpen(), false);
  assert.deepEqual(e.selected, [null, 'closed']);
  assert.equal(e.stopped.length, 1);
});

test('two simultaneous opens share one camera request and leave no stray stream', async () => {
  let calls = 0;
  const e = makeEnv({ getUserMedia: async (s) => { calls++; await new Promise((r) => setTimeout(r, 20)); return s; } });
  await Promise.all([e.view.open(), e.view.open(), e.view.open()]);
  assert.equal(calls, 1);
  e.view.close();
  assert.equal(e.stopped.length, 1, 'the one stream is stopped');
});
