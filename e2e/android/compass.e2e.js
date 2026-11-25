'use strict';
// End-to-end check of the compass on a real Android emulator (Chrome on Android, with virtual sensors).
//
// It is opt-in and is not part of `npm test`, because CI has no emulator. Run it with an emulator already booted:
//   npm run test:android
// Needs: adb on the PATH, one running Android emulator with Chrome (a Google APIs image), and Node 22.
// Set ANDROID_SERIAL to pick a device when several are connected.
//
// What it does: serves the app from this machine, opens it in Chrome on the emulator, then points the emulator's
// virtual phone at known magnetic headings (by setting its accelerometer and magnetometer) and reads the
// "Facing" line the app shows. The app must show the TRUE heading: the magnetic heading plus the declination
// for the place the app was told it is in.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const PORT = 8197, DEBUG_PORT = 9333;
const D = require('../../lib/declination.js');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const log = (...a) => { if (process.env.E2E_LOG) console.error('[e2e]', ...a); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

function findDevice() {
  if (process.env.ANDROID_SERIAL) return process.env.ANDROID_SERIAL;
  try {
    const out = execFileSync('adb', ['devices'], { encoding: 'utf8' });
    const m = out.split('\n').map((l) => l.match(/^(emulator-\d+)\s+device/)).find(Boolean);
    return m ? m[1] : null;
  } catch { return null; }
}
const SERIAL = findDevice();
const adb = (...args) => execFileSync('adb', ['-s', SERIAL, ...args], { encoding: 'utf8' });

function startServer() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

// A very small Chrome DevTools client.
function connect(url) {
  const ws = new WebSocket(url); let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const ready = new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.error || (r.result && r.result.exceptionDetails)) throw new Error('page error: ' + JSON.stringify(r.error || r.result.exceptionDetails));
    return r.result.result.value;
  };
  return { ready, send, evaluate, close: () => ws.close() };
}

async function viewerTab() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      const t = list.find((x) => x.type === 'page' && x.url.includes('localhost:' + PORT + '/viewer.html'));
      if (t) return t;
    } catch { /* Chrome is still starting */ }
    await sleep(500);
  }
  throw new Error('Chrome on the emulator never showed the viewer page');
}

// Point the virtual phone at a magnetic heading, lying flat with the screen up. The magnetometer reads the Earth's
// field in the phone's own axes: x to the right, y towards the top of the phone, z out of the screen.
function setMagneticHeading(deg) {
  const horizontal = 22, down = 42, r = deg * Math.PI / 180; // microtesla, typical mid-latitude field
  adb('emu', 'sensor', 'set', 'acceleration', '0:0:9.81');
  adb('emu', 'sensor', 'set', 'magnetic-field', `${(-horizontal * Math.sin(r)).toFixed(3)}:${(horizontal * Math.cos(r)).toFixed(3)}:${-down}`);
}

// Wait until a reading stops changing (the emulator's sensor fusion settles slowly).
async function settled(read, { stableFor = 5, tolerance = 1, timeoutMs = 90000 } = {}) {
  const start = Date.now(); const recent = [];
  while (Date.now() - start < timeoutMs) {
    const v = await read();
    log('reading', v);
    if (v != null) { recent.push(v); if (recent.length > stableFor) recent.shift(); }
    if (recent.length === stableFor && recent.every((x) => angleDiff(x, recent[0]) <= tolerance)) return recent[recent.length - 1];
    await sleep(700);
  }
  throw new Error('reading never settled; last values ' + JSON.stringify(recent));
}

const skip = SERIAL ? false : 'no Android emulator is running (start one, or set ANDROID_SERIAL)';
let server, tab;

test.before(async () => {
  if (skip) return;
  log('starting server');
  server = await startServer();
  adb('reverse', `tcp:${PORT}`, `tcp:${PORT}`);          // so localhost on the phone is this machine: a secure context, so sensors work
  adb('shell', 'am', 'force-stop', 'com.android.chrome');
  adb('shell', 'sh', '-c', `"echo 'chrome --disable-fre --no-first-run --no-default-browser-check' > /data/local/tmp/chrome-command-line"`);
  adb('shell', 'am', 'start', '-n', 'com.android.chrome/com.google.android.apps.chrome.Main', '-a', 'android.intent.action.VIEW', '-d', `http://localhost:${PORT}/viewer.html`);
  adb('forward', `tcp:${DEBUG_PORT}`, 'localabstract:chrome_devtools_remote');
  log('waiting for the Chrome tab');
  tab = await viewerTab();
  log('tab ready', tab.url);
});

test.after(async () => {
  if (skip) return;
  try { adb('forward', '--remove', `tcp:${DEBUG_PORT}`); adb('reverse', '--remove', `tcp:${PORT}`); } catch { /* already gone */ }
  if (server) server.close();
});

// Open the viewer with a saved location and the compass allowed, in a fresh page.
async function openAt(client, lat, lon) {
  await client.evaluate(`(async () => {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    for (const k of await caches.keys()) await caches.delete(k);
    localStorage.setItem('fg.loc', JSON.stringify({ lat: ${lat}, lon: ${lon} }));
    localStorage.setItem('fg.compass', 'granted');
    location.reload(); return 1; })()`);
  await sleep(3500);
}

const PLACES = [
  { name: 'Seattle, where magnetic north is about 15° east of true north', lat: 47.6, lon: -122.3 },
  { name: 'New York, where magnetic north is about 12° west of true north', lat: 40.7, lon: -74.0 },
  { name: 'Hyderabad, where the two are almost the same', lat: 17.4, lon: 78.5 },
];

test('the emulator reports a secure page and sends compass readings', { skip }, async () => {
  const c = connect(tab.webSocketDebuggerUrl); await c.ready;
  try {
    assert.equal(await c.evaluate('window.isSecureContext'), true, 'the page must be a secure context for sensors');
    await c.evaluate(`window.__alpha = null; window.addEventListener('deviceorientationabsolute', e => { window.__alpha = e.alpha; }, true); 1`);
    setMagneticHeading(90); await sleep(1000); setMagneticHeading(180);
    const alpha = await settled(async () => c.evaluate('window.__alpha'));
    // The W3C alpha counts anticlockwise from north, so a magnetic heading of 180 reads 180, and 90 reads 270.
    assert.ok(angleDiff(alpha, 180) <= 3, `alpha ${alpha} for magnetic heading 180`);
  } finally { c.close(); }
});

for (const place of PLACES) {
  test(`the Facing line is the true heading in ${place.name}`, { skip }, async () => {
    const c = connect(tab.webSocketDebuggerUrl); await c.ready;
    try {
      const decl = D.declination(place.lat, place.lon, new Date());
      await openAt(c, place.lat, place.lon);
      for (const magnetic of [0, 90, 200, 300]) {
        setMagneticHeading(magnetic);
        const shown = await settled(async () => {
          const t = await c.evaluate(`(document.querySelector('#facing') || {}).textContent || ''`);
          const m = t.match(/Facing \w+ (\d+)° \(true\)/);
          return m ? Number(m[1]) : null;
        });
        const expected = D.trueHeading(magnetic, decl);
        assert.ok(angleDiff(shown, expected) <= 3,
          `magnetic ${magnetic}° at ${place.name}: shows ${shown}°, expected about ${expected.toFixed(1)}° (declination ${decl.toFixed(1)}°)`);
      }
    } finally { c.close(); }
  });
}

test('the sky view draws N where true north is, not where magnetic north is', { skip }, async () => {
  // Facing magnetic north in Seattle (true heading about 15°), true north must be about 15° to the left of the top.
  const c = connect(tab.webSocketDebuggerUrl); await c.ready;
  try {
    const place = PLACES[0], decl = D.declination(place.lat, place.lon, new Date());
    await openAt(c, place.lat, place.lon);
    setMagneticHeading(0);
    await settled(async () => {
      const m = (await c.evaluate(`(document.querySelector('#facing') || {}).textContent || ''`)).match(/(\d+)° \(true\)/);
      return m ? Number(m[1]) : null;
    });
    // Find the red "N" mark on the radar canvas: the brightest reddish pixel cluster, then its angle from the centre.
    const where = await c.evaluate(`(() => {
      const cv = document.querySelector('#sky'), ctx = cv.getContext('2d'), w = cv.width, h = cv.height;
      const d = ctx.getImageData(0, 0, w, h).data; let sx = 0, sy = 0, n = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (d[i] > 220 && d[i + 1] > 110 && d[i + 1] < 170 && d[i + 2] > 110 && d[i + 2] < 160 && d[i + 3] > 200) { sx += x; sy += y; n++; } }
      return n ? { x: sx / n - w / 2, y: sy / n - h / 2, n } : null; })()`);
    assert.ok(where && where.n > 5, 'found the N mark on the radar');
    const angleFromTop = Math.atan2(where.x, -where.y) * 180 / Math.PI; // negative = to the left of the top
    assert.ok(Math.abs(angleFromTop + decl) <= 6, `N is ${angleFromTop.toFixed(1)}° from the top, expected about ${(-decl).toFixed(1)}°`);
  } finally { c.close(); }
});
