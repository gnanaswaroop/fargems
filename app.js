'use strict';
/* FarGems — client-only sky tracker.
 * Data: aircraft (adsb.lol → airplanes.live → OpenSky), satellites (CelesTrak TLE + satellite.js SGP4),
 * Sun/Moon/planets/stars (astronomy-engine), meteor showers (static table), clouds (Open-Meteo). */
(() => {
const $ = (s, r = document) => r.querySelector(s);
const R2D = 180 / Math.PI, AU_KM = 149597870.7;
// Pure helpers live in lib/logic.js (tested with `npm test`).
const { D2R, esc, norm360, dir16, showerView, sunPhase, moonPhaseName, ago, mix, parseV2, parseOpenSky, openSkyUrl, advance, parseTLE: parseTLEText } = window.FarGemsLogic;
const COL = { air: '#ffb454', sat: '#5ad1e6', satDim: '#5f7184', met: '#d58cff', star: '#aab6cc' };

/* ---------- static data ---------- */
const BODIES = [
  ['Sun', '#ffd86b'], ['Moon', '#e9edf5'], ['Mercury', '#c9b8a6'], ['Venus', '#fff1c2'],
  ['Mars', '#ff7b5c'], ['Jupiter', '#f1d3a6'], ['Saturn', '#e8d08a']
];
// RA/Dec in degrees (J2000). Radiants are approximate; ZHR is the typical peak zenithal rate.
const SHOWERS = [
  { n: 'Quadrantids', s: [12, 28], e: [1, 12], p: [1, 3], ra: 230, dec: 49.5, zhr: 80 },
  { n: 'Lyrids', s: [4, 14], e: [4, 30], p: [4, 22], ra: 271, dec: 34, zhr: 18 },
  { n: 'Eta Aquariids', s: [4, 19], e: [5, 28], p: [5, 6], ra: 338, dec: -1, zhr: 50 },
  { n: 'Southern Delta Aquariids', s: [7, 12], e: [8, 23], p: [7, 30], ra: 340, dec: -16, zhr: 25 },
  { n: 'Perseids', s: [7, 17], e: [8, 24], p: [8, 12], ra: 48, dec: 58, zhr: 100 },
  { n: 'Draconids', s: [10, 6], e: [10, 10], p: [10, 8], ra: 262, dec: 54, zhr: 10 },
  { n: 'Orionids', s: [10, 2], e: [11, 7], p: [10, 21], ra: 95, dec: 16, zhr: 20 },
  { n: 'Taurids', s: [9, 10], e: [12, 10], p: [11, 12], ra: 58, dec: 22, zhr: 5 },
  { n: 'Leonids', s: [11, 6], e: [11, 30], p: [11, 17], ra: 152, dec: 22, zhr: 15 },
  { n: 'Alpha Monocerotids', s: [11, 15], e: [11, 25], p: [11, 21], ra: 117.5, dec: 1, zhr: 5 },
  { n: 'Geminids', s: [12, 4], e: [12, 20], p: [12, 14], ra: 112, dec: 33, zhr: 150 },
  { n: 'Ursids', s: [12, 17], e: [12, 26], p: [12, 22], ra: 217, dec: 76, zhr: 10 }
];
const STARS = [
  ['Sirius', 101.29, -16.72], ['Canopus', 95.99, -52.70], ['Arcturus', 213.92, 19.18], ['Vega', 279.23, 38.78],
  ['Capella', 79.17, 46.0], ['Rigel', 78.63, -8.2], ['Procyon', 114.83, 5.22], ['Betelgeuse', 88.79, 7.41],
  ['Altair', 297.7, 8.87], ['Aldebaran', 68.98, 16.51], ['Antares', 247.35, -26.43], ['Spica', 201.3, -11.16],
  ['Pollux', 116.33, 28.03], ['Fomalhaut', 344.41, -29.62], ['Deneb', 310.36, 45.28], ['Regulus', 152.09, 11.97],
  ['Polaris', 37.95, 89.26], ['Acrux', 186.65, -63.1], ['Alpha Centauri', 219.9, -60.83]
];
const TLE_GROUPS = ['stations', 'visual'];

/* ---------- state ---------- */
const state = {
  loc: null, heading: 0, rot: 0, compass: false, flip: false,
  // All layers (objects, grid, labels, radar) live here; the chips and the Layers panel both edit it.
  filters: window.FarGemsLogic.defaultLayers(!!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)),
  ori: { alpha: null, beta: null, gamma: null, compassHeading: null, absolute: false },
  visOnly: (() => { try { return window.FarGemsLogic.parseVisOnly(localStorage.getItem('fg.visOnly')); } catch { return true; } })(),
  routes: new Map(), airTotal: 0, airVisible: 0, // routes: callsign -> { state, data }
  aircraft: [], aircraftAt: 0, sats: [], satsAt: 0, cloud: null,
  tempC: null, unit: (() => { try { return window.FarGemsLogic.parseUnit(localStorage.getItem('fg.unit')); } catch { return 'C'; } })(),
  objs: [], byId: new Map(), sel: null, sunAlt: null, moonIllum: null, showerView: [],
  sweep: 0, lastT: 0, // radar sweep angle (degrees) and last animation frame time
  view: { zoom: 1, panX: 0, panY: 0 }, // radar zoom and pan (see lib/logic.js)
  passes: [], dirty: true, hits: [], status: {}
};

/* ---------- helpers ---------- */
function toast(msg, ms = 3500) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms);
}
async function fetchWithTimeout(url, ms) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r;
  } finally { clearTimeout(t); }
}
const getJSON = async (u, ms = 10000) => (await fetchWithTimeout(u, ms)).json();
const getText = async (u, ms = 15000) => (await fetchWithTimeout(u, ms)).text();
const lsGet = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };
const fmtTime = d => d ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '–';
const fmtDay = ms => new Date(ms).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
const obsGd = () => ({ latitude: state.loc.lat * D2R, longitude: state.loc.lon * D2R, height: 0 });

/* ---------- aircraft ---------- */
const AC_PROVIDERS = [
  { name: 'adsb.lol', url: (la, lo, r) => `https://api.adsb.lol/v2/point/${la}/${lo}/${r}`, parse: parseV2 },
  { name: 'airplanes.live', url: (la, lo, r) => `https://api.airplanes.live/v2/point/${la}/${lo}/${r}`, parse: parseV2 },
  { name: 'OpenSky', parse: parseOpenSky, url: openSkyUrl }
];
// When the site has an aircraft proxy (config.js), use it: browsers cannot read the providers directly.
const AIRCRAFT_PROXY = (window.FARGEMS_CONFIG && window.FARGEMS_CONFIG.aircraftProxy) || '';
const AIRCRAFT_POLL_MS = 30000;
async function refreshAircraft() {
  if (!state.loc || document.hidden) return;
  const la = state.loc.lat.toFixed(3), lo = state.loc.lon.toFixed(3);
  const proxy = window.FarGemsLogic.aircraftProxyUrl(AIRCRAFT_PROXY, state.loc.lat, state.loc.lon, 150);
  const sources = proxy ? [{ name: 'FarGems proxy', url: () => proxy, parse: parseV2 }] : AC_PROVIDERS;
  for (const p of sources) {
    try {
      const list = p.parse(await getJSON(p.url(la, lo, 150)));
      state.aircraft = list; state.aircraftAt = Date.now();
      state.status.air = { src: p.name, n: list.length, t: state.aircraftAt };
      state.dirty = true; return;
    } catch { /* try next provider */ }
  }
  state.status.air = { err: true, t: state.status.air?.t };
}
function lookGd(lat, lon, altKm) {
  const ecf = satellite.geodeticToEcf({ latitude: lat * D2R, longitude: lon * D2R, height: altKm });
  const la = satellite.ecfToLookAngles(obsGd(), ecf);
  return { az: la.azimuth * R2D, el: la.elevation * R2D, range: la.rangeSat };
}

/* ---------- satellites ---------- */
const parseTLE = (text, group) => parseTLEText(text, group, (l1, l2) => satellite.twoline2satrec(l1, l2));
async function loadTLE(group) {
  const key = 'fg.tle.' + group;
  const cached = lsGet(key);
  if (cached && Date.now() - cached.t < 6 * 3600e3) return { sats: parseTLE(cached.text, group), t: cached.t };
  try {
    const text = await getText(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`);
    if (!/^1 \d{5}/m.test(text)) throw new Error('bad TLE payload');
    lsSet(key, { t: Date.now(), text });
    return { sats: parseTLE(text, group), t: Date.now() };
  } catch (e) {
    if (cached) return { sats: parseTLE(cached.text, group), t: cached.t };
    throw e;
  }
}
async function refreshSats() {
  const all = new Map(); let oldest = Date.now(), failed = 0;
  for (const g of TLE_GROUPS) {
    try {
      const r = await loadTLE(g);
      r.sats.forEach(s => { if (!all.has(s.norad)) all.set(s.norad, s); });
      oldest = Math.min(oldest, r.t);
    } catch { failed++; }
  }
  if (all.size) { state.sats = [...all.values()]; state.satsAt = oldest; state.status.sat = { n: all.size, t: oldest, partial: failed > 0 }; updatePasses(); }
  else state.status.sat = { err: true };
  state.dirty = true;
}
function lookSat(rec, date) {
  const pv = satellite.propagate(rec, date);
  if (!pv.position || typeof pv.position === 'boolean') return null;
  const gmst = satellite.gstime(date);
  const la = satellite.ecfToLookAngles(obsGd(), satellite.eciToEcf(pv.position, gmst));
  return { az: la.azimuth * R2D, el: la.elevation * R2D };
}
function nextPass(rec, from, hours = 36) {
  const step = 20000, end = from.getTime() + hours * 3600e3, MIN = 10;
  let inPass = false, p = null;
  for (let t = from.getTime(); t < end; t += step) {
    const la = lookSat(rec, new Date(t)); if (!la) continue;
    if (!inPass && la.el > MIN) { inPass = true; p = { start: t, max: la.el, riseAz: la.az }; }
    else if (inPass) {
      if (la.el > p.max) p.max = la.el;
      if (la.el <= MIN) { p.end = t; p.setAz = la.az; return p; }
    }
  }
  return p;
}
function updatePasses() {
  if (!state.loc || !state.sats.length) return;
  const out = [];
  for (const re of [/^ISS \(ZARYA\)/, /^CSS \(TIANHE\)/]) {
    const s = state.sats.find(x => re.test(x.name));
    if (s) { const p = nextPass(s.rec, new Date()); if (p) out.push({ name: re.source.includes('ISS') ? 'ISS' : 'Tiangong', ...p }); }
  }
  state.passes = out; state.passesAt = Date.now();
}

/* ---------- weather ---------- */
async function refreshCloud() {
  if (!state.loc) return;
  try {
    const j = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${state.loc.lat.toFixed(2)}&longitude=${state.loc.lon.toFixed(2)}&current=cloud_cover,temperature_2m`);
    state.cloud = j.current?.cloud_cover ?? null;
    state.tempC = j.current?.temperature_2m ?? null;
  } catch { /* optional */ }
}

/* ---------- meteor showers ---------- */

/* ---------- sky computation ---------- */
function computeSky(now) {
  if (!state.loc || typeof Astronomy === 'undefined' || typeof satellite === 'undefined') return;
  const ao = new Astronomy.Observer(state.loc.lat, state.loc.lon, 0);
  const objs = [];

  for (const [name, color] of BODIES) {
    const eq = Astronomy.Equator(name, now, ao, true, true);
    const h = Astronomy.Horizon(now, ao, eq.ra, eq.dec, 'normal');
    let mag = null, phase = null;
    try { const il = Astronomy.Illumination(name, now); mag = il.mag; phase = il.phase_fraction; } catch { /* optional */ }
    if (name === 'Sun') state.sunAlt = h.altitude;
    if (name === 'Moon') state.moonIllum = phase;
    objs.push({ id: 'body:' + name, kind: 'body', name, color, az: h.azimuth, el: h.altitude, mag: name === 'Sun' || name === 'Moon' ? null : mag, phase, distKm: eq.dist * AU_KM });
  }
  for (const [name, ra, dec] of STARS) {
    const h = Astronomy.Horizon(now, ao, ra / 15, dec, 'normal');
    objs.push({ id: 'star:' + name, kind: 'star', name, az: h.azimuth, el: h.altitude, distKm: null }); // distance to stars is not known here
  }
  state.showerView = showerView(SHOWERS, now);
  for (const sh of state.showerView) {
    if (!sh.active) continue;
    const h = Astronomy.Horizon(now, ao, sh.ra / 15, sh.dec, 'normal');
    objs.push({ id: 'met:' + sh.n, kind: 'met', name: sh.n, az: h.azimuth, el: h.altitude, shower: sh });
  }

  const gmst = satellite.gstime(now);
  const sv = Astronomy.GeoVector('Sun', now, false);
  const sun = { x: sv.x * AU_KM, y: sv.y * AU_KM, z: sv.z * AU_KM }, sl = Math.hypot(sun.x, sun.y, sun.z);
  const dark = state.sunAlt != null && state.sunAlt < -4;
  for (const s of state.sats) {
    const pv = satellite.propagate(s.rec, now);
    if (!pv.position || typeof pv.position === 'boolean') continue;
    const la = satellite.ecfToLookAngles(obsGd(), satellite.eciToEcf(pv.position, gmst));
    const el = la.elevation * R2D; if (el < 0) continue;
    const p = pv.position, d = (p.x * sun.x + p.y * sun.y + p.z * sun.z) / sl;
    const sunlit = d > 0 || Math.sqrt(Math.max(0, p.x * p.x + p.y * p.y + p.z * p.z - d * d)) > 6371;
    const v = pv.velocity || { x: 0, y: 0, z: 0 };
    objs.push({
      id: 'sat:' + s.norad, kind: 'sat', name: s.name, norad: s.norad, az: la.azimuth * R2D, el,
      range: la.rangeSat, distKm: la.rangeSat, altKm: satellite.eciToGeodetic(p, gmst).height, speed: Math.hypot(v.x, v.y, v.z),
      sunlit, visible: sunlit && dark
    });
  }

  const dt = Math.min(60, Math.max(0, (now - state.aircraftAt) / 1000));
  state.airTotal = 0; state.airVisible = 0;
  if (state.aircraftAt) for (const a of state.aircraft) {
    const p = advance(a, dt), L = lookGd(p.lat, p.lon, p.altKm);
    if (L.el < 0) continue;
    state.airTotal++;
    const seen = window.FarGemsLogic.isVisibleFlight(L.el, L.range);
    if (seen) state.airVisible++;
    if (state.visOnly && !seen) continue; // too far or too low to see from here
    const q = advance(a, dt + 15), L2 = lookGd(q.lat, q.lon, q.altKm);
    objs.push({
      id: 'air:' + a.id, kind: 'air', name: a.call || a.reg || a.id.toUpperCase(), az: L.az, el: L.el, az2: L2.az, el2: L2.el,
      range: L.range, distKm: L.range, ac: a, altFt: a.altFt + (a.vr || 0) * dt / 60
    });
  }
  state.objs = objs; state.byId = new Map(objs.map(o => [o.id, o])); state.dirty = true;
}

/* ---------- drawing ---------- */
function draw() {
  state.dirty = false;
  const cv = $('#sky'), W = Math.round(cv.clientWidth); if (!W) return;
  const dpr = window.devicePixelRatio || 1;
  if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = W * dpr; }
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, W);
  // The dome is centred on the zoom pan and scaled by the zoom level. At 1x it is unchanged.
  const V = state.view;
  const cx = W / 2 + V.panX, cy = W / 2 + V.panY, R = (W / 2 - 26) * V.zoom;
  const rot = state.compass ? state.heading : state.rot, sgn = state.flip ? 1 : -1;
  const P = (az, el) => { const r = (90 - el) / 90 * R, th = (az - rot) * D2R; return { x: cx + sgn * r * Math.sin(th), y: cy - r * Math.cos(th) }; };

  const k = Math.max(0, Math.min(1, ((state.sunAlt ?? -30) + 16) / 22));
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  g.addColorStop(0, `rgb(${mix([6, 10, 24], [40, 92, 160], k)})`);
  g.addColorStop(1, `rgb(${mix([14, 22, 44], [120, 170, 215], k)})`);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(160,180,210,.28)'; ctx.lineWidth = 1;
  if (state.filters.grid) for (const el of [0, 30, 60]) { ctx.beginPath(); ctx.arc(cx, cy, (90 - el) / 90 * R, 0, 7); ctx.stroke(); }
  ctx.font = '11px system-ui'; ctx.fillStyle = 'rgba(160,180,210,.6)'; ctx.textAlign = 'left';
  if (state.filters.grid) { ctx.fillText('30°', cx + 3, cy - (60 / 90) * R + 12); ctx.fillText('60°', cx + 3, cy - (30 / 90) * R + 12); }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '600 13px system-ui';
  [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([t, az]) => {
    const p = P(az, -9); ctx.fillStyle = t === 'N' ? '#ff8a80' : '#aab6cc'; ctx.fillText(t, p.x, p.y);
  });
  ctx.textBaseline = 'alphabetic';

  if (state.filters.radar) { // radar sweep: a fading wedge plus a bright line, turning clockwise
    for (const s of window.FarGemsLogic.sweepWedge(state.sweep, 60, 24)) {
      ctx.fillStyle = `rgba(90,209,230,${s.alpha.toFixed(3)})`; ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, (s.from - 90) * D2R, (s.to - 90) * D2R); ctx.closePath(); ctx.fill();
    }
    const a = (state.sweep - 90) * D2R;
    ctx.strokeStyle = 'rgba(90,209,230,.75)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.lineTo(cx + R * Math.cos(a), cy + R * Math.sin(a)); ctx.stroke();
  }
  state.hits = [];
  const F = state.filters, sel = state.sel;
  const label = (o, p, dx = 8, dy = -8, col = '#cfd8e8') => { if (!F.labels) return; ctx.fillStyle = col; ctx.textAlign = 'left'; ctx.font = '11px system-ui'; ctx.fillText(o.name, p.x + dx, p.y + dy); };
  const hit = (o, p, r) => state.hits.push({ id: o.id, x: p.x, y: p.y, r: Math.max(r, 14) });

  for (const o of state.objs) { // stars
    if (o.kind !== 'star' || !F.star || o.el < 0) continue;
    const p = P(o.az, o.el); ctx.fillStyle = COL.star; ctx.beginPath(); ctx.arc(p.x, p.y, 1.8, 0, 7); ctx.fill();
    label(o, p, 5, -4, 'rgba(170,182,204,.75)'); hit(o, p, 10);
  }
  for (const o of state.objs) { // meteor radiants
    if (o.kind !== 'met' || !F.met || o.el < -5) continue;
    const p = P(o.az, Math.max(0, o.el)); ctx.strokeStyle = COL.met; ctx.setLineDash([3, 3]); ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(p.x - 5, p.y); ctx.lineTo(p.x + 5, p.y); ctx.moveTo(p.x, p.y - 5); ctx.lineTo(p.x, p.y + 5); ctx.stroke();
    label(o, p, 12, 4, COL.met); hit(o, p, 14);
  }
  for (const o of state.objs) { // satellites
    if (o.kind !== 'sat' || !F.sat) continue;
    const p = P(o.az, o.el), major = /^(ISS|CSS)/.test(o.name);
    ctx.fillStyle = o.visible ? '#ffffff' : (o.sunlit ? COL.sat : COL.satDim);
    if (o.visible) { ctx.shadowColor = COL.sat; ctx.shadowBlur = 8; }
    const r = major ? 4.2 : 2.6; ctx.beginPath(); ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + r, p.y); ctx.lineTo(p.x, p.y + r); ctx.lineTo(p.x - r, p.y); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    if (major || o.id === sel) label(o, p, 7, -6, COL.sat); hit(o, p, 11);
  }
  for (const o of state.objs) { // aircraft
    if (o.kind !== 'air' || !F.air) continue;
    const p = P(o.az, o.el), q = P(o.az2, o.el2);
    const ang = Math.atan2(q.y - p.y, q.x - p.x);
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(window.FarGemsLogic.planeRotation(ang)); ctx.fillStyle = COL.air;
    ctx.font = (o.id === sel ? 24 : 19) + 'px "Segoe UI Symbol","Noto Sans Symbols2","Apple Symbols","DejaVu Sans",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(window.FarGemsLogic.PLANE_GLYPH, 0, 0); ctx.restore();
    if (o.id === sel || state.objs.length < 60) label(o, p, 8, -6, 'rgba(255,180,84,.9)'); hit(o, p, 12);
  }
  for (const o of state.objs) { // Sun, Moon, planets
    if (o.kind !== 'body' || !F.sky || o.el < -1) continue;
    const p = P(o.az, Math.max(0, o.el)); const big = o.name === 'Sun' || o.name === 'Moon';
    const r = big ? 8 : Math.max(2.5, 5.5 - (o.mag ?? 0) * 0.8);
    ctx.fillStyle = o.color; ctx.shadowColor = o.color; ctx.shadowBlur = big ? 14 : 6;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
    label(o, p, r + 4, 4, '#fff'); hit(o, p, r + 8);
  }
  const so = sel && state.byId.get(sel);
  if (so && so.el >= -1) { const p = P(so.az, Math.max(0, so.el)); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, 13, 0, 7); ctx.stroke(); }
}
// Animation loop: redraws when something changed, and every frame while the radar sweep is on.
function loop(t) {
  const dt = state.lastT ? t - state.lastT : 0;
  state.lastT = t;
  if (state.filters.radar) {
    state.sweep = window.FarGemsLogic.sweepAngle(state.sweep, dt);
    state.dirty = true;
  }
  if (state.dirty) draw();
  requestAnimationFrame(loop);
}

/* ---------- UI ---------- */
const L = window.FarGemsLogic;
const storedValue = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const reducedMotion = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

function moonName() {
  try { return moonPhaseName(Astronomy.MoonPhase(new Date())); } catch { return 'Moon'; }
}
function renderHud() {
  const parts = [];
  if (state.sunAlt != null) parts.push(`${sunPhase(state.sunAlt)} · Sun ${Math.round(state.sunAlt)}°`);
  if (state.moonIllum != null) parts.push(`${moonName()} ${Math.round(state.moonIllum * 100)}%`);
  if (state.cloud != null) parts.push(`Cloud ${Math.round(state.cloud)}%`);
  if (state.tempC != null) parts.push(L.formatTemp(state.tempC, state.unit));
  $('#hud').innerHTML = parts.map(esc).join('<br>');
}
function renderStatus() {
  const s = state.status, now = Date.now(), out = [];
  if (state.loc) out.push(`<span>${state.loc.lat.toFixed(2)}°, ${state.loc.lon.toFixed(2)}°</span>`);
  if (s.air) out.push(s.air.err ? '<span class="bad">Aircraft: feed unreachable</span>' : `<span>Aircraft: ${esc(s.air.src)} · ${state.visOnly ? `${state.airVisible} visible of ${s.air.n}` : `${s.air.n} nearby`} · ${ago(now - s.air.t)} ago</span>`);
  else out.push('<span>Aircraft: loading…</span>');
  if (s.sat) out.push(s.sat.err ? '<span class="bad">Satellites: data unreachable</span>' : `<span class="${now - s.sat.t > 10 * 864e5 ? 'bad' : ''}">Satellites: ${s.sat.n} tracked · elements ${ago(now - s.sat.t)} old</span>`);
  else out.push('<span>Satellites: loading…</span>');
  $('#status').innerHTML = out.join('');
}
function renderPasses() {
  const el = $('#passes');
  if (!state.passes.length) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = '<h3>Next station passes (≥10°)</h3><dl>' + state.passes.map(p =>
    `<dt>${esc(p.name)}</dt><dd>${esc(fmtDay(p.start))} · max ${Math.round(p.max)}° · ${dir16(p.riseAz)} → ${p.setAz != null ? dir16(p.setAz) : '…'}</dd>`).join('') + '</dl>';
}
function riseSet(name) {
  try {
    const ao = new Astronomy.Observer(state.loc.lat, state.loc.lon, 0), now = new Date();
    const r = Astronomy.SearchRiseSet(name, ao, +1, now, 2), s = Astronomy.SearchRiseSet(name, ao, -1, now, 2);
    return `rise ${fmtTime(r && r.date)} · set ${fmtTime(s && s.date)}`;
  } catch { return null; }
}
// The selected-object card. With nothing selected it shows a hint, so the card always has a purpose.
// Where the selected flight started and where it is going, from the proxy's route lookup.
function routeText(a) {
  const base = AIRCRAFT_PROXY, H = window.FarGemsLogic;
  if (!a.call) return 'Unknown (no flight number)';
  const url = H.routeProxyUrl(base, a.call, a.lat, a.lon);
  if (!url) return `Not available here. Heading ${dir16(a.track)} (${Math.round(a.track)}°)`;
  const r = state.routes.get(a.call);
  if (!r) {
    state.routes.set(a.call, { state: 'loading' });
    getJSON(url).then(data => state.routes.set(a.call, { state: 'done', data }))
      .catch(() => state.routes.set(a.call, { state: 'failed' }))
      .finally(() => { if (state.sel === 'air:' + a.id) renderDetail(); });
    return 'Looking up…';
  }
  if (r.state === 'loading') return 'Looking up…';
  if (r.state === 'failed') return `Lookup failed. Heading ${dir16(a.track)} (${Math.round(a.track)}°)`;
  const d = r.data && r.data.destination, o = r.data && r.data.origin;
  if (!d) return `Not known. Heading ${dir16(a.track)} (${Math.round(a.track)}°)`;
  const far = d.lat != null ? ` · ${Math.round(H.distanceKm(a.lat, a.lon, d.lat, d.lon)).toLocaleString()} km to go` : '';
  return esc(H.describeAirport(d)) + far + (o ? `<br><small class="muted">from ${esc(H.describeAirport(o))}</small>` : '');
}
function renderDetail() {
  // The same card shows under the radar and over the camera picture.
  const put = (h) => { $('#detail').innerHTML = h; $('#arDetail').innerHTML = h; };
  const o = state.sel && state.byId.get(state.sel);
  if (!o) { put('<p class="muted">Tap an object on the radar to see its details.</p>'); return; }
  const kv = (k, v) => v == null || v === '' ? '' : `<dt>${k}</dt><dd>${v}</dd>`;
  let title = esc(o.name), rows = '';
  const here = kv('Sky position', `${Math.round(o.el)}° up · ${dir16(o.az)} (${Math.round(o.az)}°)`);
  if (o.kind === 'air') {
    const a = o.ac;
    title += a.type ? ` <small class="muted">${esc(a.type)}</small>` : '';
    rows = here + kv('Altitude', `${Math.round(o.altFt).toLocaleString()} ft (FL${String(Math.round(o.altFt / 100)).padStart(3, '0')})`)
      + kv('Speed', `${Math.round(a.gs)} kt · ${Math.round(a.gs * 1.852)} km/h`) + kv('Heading', `${Math.round(a.track)}° ${dir16(a.track)}`)
      + kv('Vertical', a.vr ? `${a.vr > 0 ? '+' : ''}${Math.round(a.vr)} ft/min` : 'level') + kv('Distance', `${Math.round(o.range)} km`)
      + kv('Flying to', routeText(a))
      + kv('Registration', esc(a.reg)) + kv('ICAO hex', esc(a.id.toUpperCase()))
      + (a.call ? kv('Track', `<a href="https://www.flightaware.com/live/flight/${encodeURIComponent(a.call)}" target="_blank" rel="noopener">FlightAware ↗</a>`) : '');
  } else if (o.kind === 'sat') {
    rows = here + kv('Altitude', `${Math.round(o.altKm)} km`) + kv('Speed', `${o.speed.toFixed(2)} km/s`) + kv('Distance', `${Math.round(o.range)} km`)
      + kv('Lighting', o.visible ? 'Sunlit against a dark sky — visible to the eye' : o.sunlit ? 'Sunlit, but the sky is too bright' : 'In Earth’s shadow')
      + kv('NORAD ID', o.norad) + kv('More', `<a href="https://www.n2yo.com/satellite/?s=${o.norad}" target="_blank" rel="noopener">N2YO ↗</a>`);
  } else if (o.kind === 'body') {
    rows = here + kv('Magnitude', o.mag != null ? o.mag.toFixed(1) : null) + kv('Illuminated', o.phase != null && o.name !== 'Sun' ? Math.round(o.phase * 100) + '%' : null) + kv('Today', riseSet(o.name));
  } else if (o.kind === 'met') {
    const s = o.shower;
    rows = kv('Radiant', `${Math.round(o.el)}° up · ${dir16(o.az)}`) + kv('Peak rate', `up to ~${s.zhr}/hour under dark skies`)
      + kv('Moon', state.moonIllum != null ? `${Math.round(state.moonIllum * 100)}% lit — a bright Moon hides faint meteors` : null)
      + kv('Tip', 'Look about 40° away from the radiant, dark site, no phone light.');
  } else rows = here;
  put(`<h3>${title}</h3><dl>${rows}</dl>`);
}
// Nearby list: aircraft, satellites, Sun, Moon, planets and stars, nearest first.
// Each row gives the distance and where to look (with your heading when the compass is on).
function renderNearby() {
  const el = $('#nearbyList');
  if (!el) return;
  const H = window.FarGemsLogic;
  const heading = state.compass ? state.heading : null;
  const items = state.objs.filter(o => ['air', 'sat', 'body', 'star'].includes(o.kind) && (o.el >= -1 || o.kind === 'body'));
  const sorted = H.sortNearest(items).slice(0, 60);
  if (!sorted.length) { el.innerHTML = '<li class="muted">Nothing above the horizon right now.</li>'; return; }
  el.innerHTML = sorted.map(o =>
    `<li><button class="nearby-row${state.sel === o.id ? ' sel' : ''}" data-id="${esc(o.id)}" type="button">` +
    `<span class="nm">${esc(o.name)}</span>` +
    `<span class="meta">${esc(H.formatDistance(o.distKm))}</span>` +
    `<span class="where">${esc(H.describeDirection(o.az, o.el, heading))}</span></button></li>`).join('');
}
function renderAll() { renderHud(); renderStatus(); renderDetail(); renderPasses(); renderNearby(); }

// Two pages: Radar and Nearby. Tabs switch; a horizontal swipe outside the radar also switches.
function setPage(name) {
  const nearby = name === 'nearby';
  $('#pager').classList.toggle('nearby', nearby);
  $('#tabRadar').classList.toggle('on', !nearby);
  $('#tabNearby').classList.toggle('on', nearby);
  $('#tabRadar').setAttribute('aria-selected', String(!nearby));
  $('#tabNearby').setAttribute('aria-selected', String(nearby));
  if (!nearby) state.dirty = true;
}

/* ---------- location ---------- */
function setLoc(lat, lon) {
  state.loc = { lat, lon }; lsSet('fg.loc', state.loc);
  $('#noLocation').hidden = true;
  state.aircraft = []; state.aircraftAt = 0; state.cloud = null; state.tempC = null;
  tick(); refreshAircraft(); refreshCloud(); updatePasses(); renderAll();
}

/* ---------- compass & interaction ---------- */
function onOri(e) {
  const ori = state.ori; // raw angles for the AR view
  if (typeof e.beta === 'number') { ori.beta = e.beta; ori.gamma = e.gamma || 0; }
  if (typeof e.webkitCompassHeading === 'number') ori.compassHeading = e.webkitCompassHeading;
  if ((e.absolute === true || e.type === 'deviceorientationabsolute') && e.alpha != null) { ori.alpha = e.alpha; ori.absolute = true; }
  let h = null;
  if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
  else if ((e.absolute === true || e.type === 'deviceorientationabsolute') && e.alpha != null) h = norm360(360 - e.alpha);
  if (h == null) return;
  let d = norm360(h - state.heading + 180) - 180;
  state.heading = norm360(state.heading + d * 0.25); state.dirty = true;
}
// The compass is switched on in settings. The sky view only starts it when permission was already granted there.
function startCompass() {
  if (state.compass) return;
  if (!startCompass.bound) {
    window.addEventListener('deviceorientationabsolute', onOri, true);
    window.addEventListener('deviceorientation', onOri, true);
    startCompass.bound = true;
  }
  state.compass = true; state.dirty = true;
}
/* ---------- AR view ---------- */
// The camera picture with objects over it. It opens from the AR button, and by itself when the phone is
// raised to look at the sky (once the camera has been allowed). Laying the phone flat closes it.
let arView = null;
const arState = { suppressed: false, since: 0, want: false };
function initAR() {
  if (!window.FarGemsARView || !window.FarGemsAR) return;
  arView = window.FarGemsARView.create({
    root: $('#ar'), video: $('#arVideo'), canvas: $('#arCanvas'), closeBtn: $('#arClose'),
    getObjects: () => state.objs, getFilters: () => state.filters, getSelected: () => state.sel, getOrientation: () => state.ori,
    onSelect: (id) => { state.sel = id; state.dirty = true; renderDetail(); },
    onClose: () => { arState.suppressed = true; }, // stay on the radar until the phone has been laid flat once
  });
  $('#arBtn').onclick = openAR;
  setInterval(autoAR, 300);
}
async function openAR() {
  if (!arView || arView.isOpen()) return;
  try {
    // iPhone asks for the compass inside a tap, so ask here before the camera.
    const O = window.FarGemsOnboarding;
    if (!state.compass) {
      if (O.compassNeedsPermission(window)) {
        const r = await DeviceOrientationEvent.requestPermission();
        O.storeCompass(localStorage, r === 'granted' ? 'granted' : 'denied');
        if (r === 'granted') startCompass(); else toast('Compass permission is needed for AR. You can allow it in Settings.');
      } else startCompass();
    }
    await arView.open();
    try { localStorage.setItem('fg.camera', 'granted'); } catch { /* storage blocked */ }
    renderDetail();
  } catch (e) {
    const why = e && e.code === 'denied' ? 'Camera permission was refused. Allow it in your browser settings to use AR.'
      : e && e.code === 'unsupported' ? 'This browser cannot open the camera here (it needs https).' : 'Could not start the camera.';
    toast(why, 5000);
  }
}
// Called every 300 ms: open or close the camera view from how the phone is held.
function autoAR() {
  if (!arView || state.ori.beta == null) return;
  const pose = window.FarGemsAR.cameraPose(state.ori.alpha, state.ori.beta, state.ori.gamma);
  const want = window.FarGemsAR.wantsAR(arState.want, pose.pitch);
  if (want !== arState.want) { arState.want = want; arState.since = Date.now(); }
  if (Date.now() - arState.since < 700) return; // held steadily for a moment
  if (!want) { arState.suppressed = false; if (arView.isOpen()) arView.close(); return; }
  let granted = false; try { granted = localStorage.getItem('fg.camera') === 'granted'; } catch { /* blocked */ }
  if (granted && state.compass && !arState.suppressed && !arView.isOpen() && !$('#pager').classList.contains('nearby')) openAR();
}
function bindUI() {
  const cv = $('#sky');
  const pointers = new Map(); // active touches or mouse buttons, by pointer id
  let down = null, pinchDist = 0;
  const canvasW = () => Math.round(cv.clientWidth);
  const zoomTo = (factor, px, py) => {
    const W = canvasW(); if (!W) return;
    state.view = window.FarGemsLogic.zoomAt(state.view, state.view.zoom * factor, px, py, W);
    state.dirty = true;
  };
  const resetView = () => { state.view = window.FarGemsLogic.resetView(); state.rot = 0; state.dirty = true; };
  const dist = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) down = { x: e.clientX, y: e.clientY, moved: false };
    if (pointers.size === 2) { pinchDist = dist(); down = { moved: true }; } // two fingers: pinch, not tap
  });
  cv.addEventListener('pointermove', e => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const r = cv.getBoundingClientRect();
    const prev = { x: p.x, y: p.y };
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size >= 2) {
      const d = dist();
      const f = window.FarGemsLogic.pinchFactor(pinchDist, d);
      const mid = [...pointers.values()].reduce((m, q) => ({ x: m.x + q.x / 2, y: m.y + q.y / 2 }), { x: 0, y: 0 });
      zoomTo(f, mid.x - r.left, mid.y - r.top);
      pinchDist = d;
      return;
    }
    if (!down) return;
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    if (Math.abs(e.clientX - down.x) > 6 || Math.abs(e.clientY - down.y) > 6) down.moved = true;
    if (!down.moved) return;
    if (state.view.zoom > 1) {
      // zoomed in: drag pans the view
      state.view = window.FarGemsLogic.panBy(state.view, dx, dy, canvasW());
      state.dirty = true;
    } else if (!state.compass) {
      // at 1x: drag rotates the sky, as before
      state.rot = norm360(state.rot + (state.flip ? -1 : 1) * (e.clientX - prev.x) * 0.4);
      state.dirty = true;
    }
  });
  const endPointer = e => {
    const wasTap = pointers.size === 1 && down && !down.moved;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    if (wasTap) {
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      let best = null, bd = 1e9;
      for (const h of state.hits) { const raw = Math.hypot(h.x - x, h.y - y), d = raw + (h.id.startsWith('star:') ? 10 : 0); /* flights win over a star behind them */ if (raw < h.r && d < bd) { best = h; bd = d; } }
      state.sel = best ? best.id : null; state.dirty = true; renderDetail();
    }
    if (pointers.size === 0) down = null;
  };
  cv.addEventListener('pointerup', endPointer);
  cv.addEventListener('pointercancel', endPointer);
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const r = cv.getBoundingClientRect();
    zoomTo(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  // Buttons: zoom about the centre of the dome, and reset.
  const centre = () => { const W = canvasW(); return { x: W / 2 + state.view.panX, y: W / 2 + state.view.panY }; };
  $('#zoomIn').onclick = () => { const c = centre(); zoomTo(1.5, c.x, c.y); };
  $('#zoomOut').onclick = () => { const c = centre(); zoomTo(1 / 1.5, c.x, c.y); };
  $('#zoomReset').onclick = resetView;
  initAR();
  // Tabs and swipes. Swipes that start on the radar are left alone, because dragging there rotates the sky.
  $('#tabRadar').onclick = () => setPage('radar');
  $('#tabNearby').onclick = () => setPage('nearby');
  $('#nearbyList').onclick = e => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    state.sel = b.dataset.id; state.dirty = true; renderNearby(); renderDetail(); setPage('radar');
  };
  const pager = $('#pager'); let sw = null;
  pager.addEventListener('pointerdown', e => {
    if (e.target.closest('#sky, .zoombar')) return;
    sw = { x: e.clientX, y: e.clientY };
  });
  pager.addEventListener('pointerup', e => {
    if (!sw) return;
    const dir = window.FarGemsLogic.swipeDirection(e.clientX - sw.x, e.clientY - sw.y);
    sw = null;
    if (dir === 'left') setPage('nearby');
    else if (dir === 'right') setPage('radar');
  });
  window.addEventListener('resize', () => { state.dirty = true; });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshAircraft(); tick(); } });
}

/* ---------- timers ---------- */
function tick() { try { computeSky(new Date()); } catch (e) { console.error(e); } }
function start() {
  bindUI();
  // Choices made in settings.html.
  state.flip = storedValue('fg.flip') === '1';
  state.visOnly = L.parseVisOnly(storedValue('fg.visOnly'));
  state.filters = L.loadLayers(storedValue('fg.layers'), reducedMotion());
  if (typeof satellite === 'undefined' || typeof Astronomy === 'undefined') {
    $('#status').innerHTML = '<span class="bad">Sky libraries failed to load. Check your connection and reload.</span>';
  }
  const saved = lsGet('fg.loc');
  if (saved && typeof saved.lat === 'number' && typeof saved.lon === 'number') setLoc(saved.lat, saved.lon);
  else $('#noLocation').hidden = false;
  // Compass permission from settings (or the landing page) turns the compass on without a second prompt.
  try { if (window.FarGemsOnboarding && FarGemsOnboarding.shouldAutoEnableCompass(localStorage)) startCompass(); } catch { /* storage blocked */ }
  renderAll();
  refreshSats();
  setInterval(() => { tick(); }, 1000);
  setInterval(renderAll, 2000);
  setInterval(refreshAircraft, AIRCRAFT_POLL_MS);
  setInterval(refreshCloud, 15 * 60e3);
  setInterval(refreshSats, 3600e3);
  setInterval(updatePasses, 20 * 60e3);
  requestAnimationFrame(loop);
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => { /* optional */ });
}
start();
})();
