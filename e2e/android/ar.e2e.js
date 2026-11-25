'use strict';
// End-to-end check of the camera (AR) view on a real Android (Chrome) emulator, with its virtual camera and sensors.
// Opt-in, like compass.e2e.js:  npm run test:android   (needs adb and one running emulator with Chrome)
//
// It checks what a visitor does, from the state a real Android phone is in after the landing page:
//   - the compass starts by itself (the landing page recorded "no permission needed"),
//   - the AR button opens the camera view and it STAYS open, even with the phone held low,
//   - raising the phone opens the view by itself once the camera has been allowed, and laying it flat closes it again,
//   - a view opened with the AR button is not closed by laying the phone flat.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers.js');

const PORT = 8198, DEBUG_PORT = 9334;
const skip = H.SERIAL ? false : 'no Android emulator is running (start one, or set ANDROID_SERIAL)';
let server, tab;

test.before(async () => {
  if (skip) return;
  server = await H.startServer(PORT);
  H.adb('reverse', `tcp:${PORT}`, `tcp:${PORT}`);
  try { H.adb('shell', 'pm', 'grant', 'com.android.chrome', 'android.permission.CAMERA'); } catch { /* already granted */ }
  H.adb('shell', 'am', 'force-stop', 'com.android.chrome');
  H.adb('shell', 'sh', '-c', `"echo 'chrome --disable-fre --no-first-run --no-default-browser-check --use-fake-ui-for-media-stream' > /data/local/tmp/chrome-command-line"`);
  H.adb('shell', 'am', 'start', '-n', 'com.android.chrome/com.google.android.apps.chrome.Main', '-a', 'android.intent.action.VIEW', '-d', `http://localhost:${PORT}/viewer.html`);
  H.adb('forward', `tcp:${DEBUG_PORT}`, 'localabstract:chrome_devtools_remote');
  tab = await H.findTab(DEBUG_PORT, `localhost:${PORT}/viewer.html`);
  H.log('tab ready');
});

test.after(async () => {
  if (skip) return;
  try { H.adb('forward', '--remove', `tcp:${DEBUG_PORT}`); H.adb('reverse', '--remove', `tcp:${PORT}`); } catch { /* gone */ }
  if (server) server.close();
});

// A fresh viewer page in the state a real Android phone is in after the landing page: a saved location, and compass "na".
async function openViewer(c, { cameraGranted }) {
  // The emulator's headless virtual camera is not reliable, so the page gets a synthetic camera picture (a canvas stream)
  // instead. That still exercises everything the app does around the camera: opening, the stream, closing, permission
  // bookkeeping. (Browser.grantPermissions is not used: it resets the other site permissions, motion sensors included.)
  await c.send('Page.enable');
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    (() => {
      const make = () => { const cv = document.createElement('canvas'); cv.width = 320; cv.height = 240; const g = cv.getContext('2d');
        setInterval(() => { g.fillStyle = '#123'; g.fillRect(0, 0, 320, 240); g.fillStyle = '#fff'; g.fillText(String(Date.now()), 10, 20); }, 200); return cv.captureStream(5); };
      if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => make();
    })();` });
  await c.evaluate(`(async () => {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    for (const k of await caches.keys()) await caches.delete(k);
    localStorage.clear();
    localStorage.setItem('fg.loc', JSON.stringify({ lat: 47.6, lon: -122.3 }));
    localStorage.setItem('fg.compass', 'na');
    ${cameraGranted ? "localStorage.setItem('fg.camera', 'granted');" : ''}
    setTimeout(() => location.reload(), 50); return 1; })()`); // reload after answering, or the answer never arrives
  await H.sleep(3500);
}
const arOpen = (c) => c.evaluate(`(() => { const a = document.querySelector('#ar'); const v = document.querySelector('#arVideo'); return { open: !!a && !a.hidden, streaming: !!(v && v.srcObject) }; })()`);
const facing = (c) => c.evaluate(`(document.querySelector('#facing') || {}).textContent || ''`);
const pitchSeen = (c) => c.evaluate(`window.__beta == null ? null : window.__beta`);
async function watchBeta(c) {
  await c.evaluate(`window.__beta = null; for (const n of ['deviceorientation', 'deviceorientationabsolute']) window.addEventListener(n, e => { if (typeof e.beta === 'number') window.__beta = e.beta; }, true); 1`);
}

test('the compass starts by itself on Android, with no tap and no stored grant', { skip }, async () => {
  const c = H.connect(tab.webSocketDebuggerUrl); await c.ready;
  try {
    await openViewer(c, { cameraGranted: false });
    H.setPhone({ heading: 90, upright: false });
    const text = await H.settledValue(() => facing(c), (t) => /Facing \w+ \d+° \(true\)/.test(t));
    assert.match(text, /Facing/, 'the Facing line appears: the compass is on');
  } finally { c.close(); }
});

test('the AR button opens the camera view and it stays open with the phone held low', { skip }, async () => {
  const c = H.connect(tab.webSocketDebuggerUrl); await c.ready;
  try {
    await openViewer(c, { cameraGranted: false });
    await watchBeta(c);
    H.setPhone({ heading: 0, upright: false }); // flat: the tilt rule would close an automatic view at once
    await H.settledValue(() => pitchSeen(c), (b) => b != null && Math.abs(b) < 15);
    await c.evaluate(`document.querySelector('#arBtn').click(); 1`);
    const opened = await H.settledValue(() => arOpen(c), (s) => s.open, { timeoutMs: 30000, stableFor: 1 });
    assert.equal(opened.open, true, 'the camera view opened');
    await H.sleep(5000); // long enough for the tilt rule (700 ms) to have closed it before the fix
    const after = await arOpen(c);
    assert.equal(after.open, true, 'still open five seconds later, with the phone flat');
    assert.equal(after.streaming, true, 'the camera picture is running');
    await c.evaluate(`document.querySelector('#arClose').click(); 1`);
    assert.equal((await arOpen(c)).open, false, 'the close button closes it');
  } finally { c.close(); }
});

test('raising the phone opens the camera view by itself, and laying it flat closes it again', { skip }, async () => {
  const c = H.connect(tab.webSocketDebuggerUrl); await c.ready;
  try {
    await openViewer(c, { cameraGranted: true }); // the camera was allowed on an earlier visit
    await watchBeta(c);
    H.setPhone({ heading: 0, upright: false });
    await H.settledValue(() => pitchSeen(c), (b) => b != null && Math.abs(b) < 15);
    assert.equal((await arOpen(c)).open, false, 'not open while the phone is flat');
    H.setPhone({ heading: 0, upright: true });
    const opened = await H.settledValue(() => arOpen(c), (s) => s.open, { timeoutMs: 60000, stableFor: 1 });
    assert.equal(opened.open, true, 'opened by itself when the phone was raised');
    H.setPhone({ heading: 0, upright: false });
    const closed = await H.settledValue(() => arOpen(c), (s) => !s.open, { timeoutMs: 60000, stableFor: 2 });
    assert.equal(closed.open, false, 'closed again when the phone was laid flat');
  } finally { c.close(); }
});

test('a view opened with the AR button is not closed by laying the phone flat', { skip }, async () => {
  const c = H.connect(tab.webSocketDebuggerUrl); await c.ready;
  try {
    // The camera has not been allowed yet, so raising the phone does not open it by itself: only the button does.
    await openViewer(c, { cameraGranted: false });
    await watchBeta(c);
    H.setPhone({ heading: 0, upright: true });
    await H.settledValue(() => pitchSeen(c), (b) => b != null && b > 70);
    await c.evaluate(`document.querySelector('#arBtn').click(); 1`);
    await H.settledValue(() => arOpen(c), (s) => s.open, { timeoutMs: 30000, stableFor: 1 });
    H.setPhone({ heading: 0, upright: false });
    await H.settledValue(() => pitchSeen(c), (b) => b != null && Math.abs(b) < 15);
    await H.sleep(5000);
    assert.equal((await arOpen(c)).open, true, 'still open: only the close button closes a view opened by hand');
  } finally { c.close(); }
});
