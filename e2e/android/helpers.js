'use strict';
// Shared helpers for the Android emulator tests: find the device, serve the app, drive Chrome through DevTools,
// and move the emulator's virtual phone. See compass.e2e.js for the full story of how this works.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => { if (process.env.E2E_LOG) console.error('[e2e]', ...a); };

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

function startServer(port) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

// A very small Chrome DevTools client.
function connect(url) {
  const ws = new WebSocket(url); let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const ready = new Promise((r) => { ws.onopen = r; });
  // A call that gets no answer in 30 s fails, instead of hanging the whole run (a page that navigates away mid-call never answers).
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id; const timer = setTimeout(() => { pending.delete(i); reject(new Error('no answer to ' + method)); }, 30000);
    pending.set(i, (d) => { clearTimeout(timer); resolve(d); });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.error || (r.result && r.result.exceptionDetails)) throw new Error('page error: ' + JSON.stringify(r.error || r.result.exceptionDetails));
    return r.result.result.value;
  };
  return { ready, send, evaluate, close: () => ws.close() };
}

async function findTab(debugPort, match) {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      const t = list.find((x) => x.type === 'page' && x.url.includes(match));
      if (t) return t;
    } catch { /* Chrome is still starting */ }
    await sleep(500);
  }
  throw new Error('Chrome on the emulator never showed ' + match);
}

// Move the emulator's virtual phone by setting its accelerometer and magnetometer. The magnetometer reads the Earth's
// field in the phone's own axes: x to the right, y towards the top, z out of the screen (the back camera looks along -z).
// The Earth's field here has a horizontal part pointing at magnetic north and a part pointing down.
//   flat:    lying face up, top of the phone pointing at magnetic `heading`   -> field (-H sin h, H cos h, -D)
//   upright: held up in portrait, back camera level, pointing at `heading`    -> field (-H sin h, -D, -H cos h)
function setPhone({ heading = 0, upright = false } = {}) {
  const r = heading * Math.PI / 180, H = 22, D = 42;
  if (!upright) {
    adb('emu', 'sensor', 'set', 'acceleration', '0:0:9.81');
    adb('emu', 'sensor', 'set', 'magnetic-field', `${(-H * Math.sin(r)).toFixed(3)}:${(H * Math.cos(r)).toFixed(3)}:${-D}`);
  } else {
    adb('emu', 'sensor', 'set', 'acceleration', '0:9.81:0');
    adb('emu', 'sensor', 'set', 'magnetic-field', `${(-H * Math.sin(r)).toFixed(3)}:${-D}:${(-H * Math.cos(r)).toFixed(3)}`);
  }
}

async function settledValue(read, ok, { timeoutMs = 90000, stableFor = 4 } = {}) {
  const start = Date.now(); let streak = 0, last;
  while (Date.now() - start < timeoutMs) {
    last = await read();
    if (ok(last)) { streak++; if (streak >= stableFor) return last; } else streak = 0;
    await sleep(700);
  }
  throw new Error('never settled; last value ' + JSON.stringify(last));
}

module.exports = { SERIAL, adb, sleep, log, startServer, connect, findTab, setPhone, settledValue };
