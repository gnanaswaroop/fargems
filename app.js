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
  filters: { air: true, sat: true, sky: true, met: true, star: true },
  aircraft: [], aircraftAt: 0, sats: [], satsAt: 0, cloud: null,
  objs: [], byId: new Map(), sel: null, sunAlt: null, moonIllum: null, showerView: [],
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
async function refreshAircraft() {
  if (!state.loc || document.hidden) return;
  const la = state.loc.lat.toFixed(3), lo = state.loc.lon.toFixed(3);
  for (const p of AC_PROVIDERS) {
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
    const j = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${state.loc.lat.toFixed(2)}&longitude=${state.loc.lon.toFixed(2)}&current=cloud_cover`);
    state.cloud = j.current?.cloud_cover ?? null;
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
    objs.push({ id: 'body:' + name, kind: 'body', name, color, az: h.azimuth, el: h.altitude, mag: name === 'Sun' || name === 'Moon' ? null : mag, phase });
  }
  for (const [name, ra, dec] of STARS) {
    const h = Astronomy.Horizon(now, ao, ra / 15, dec, 'normal');
    objs.push({ id: 'star:' + name, kind: 'star', name, az: h.azimuth, el: h.altitude });
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
      range: la.rangeSat, altKm: satellite.eciToGeodetic(p, gmst).height, speed: Math.hypot(v.x, v.y, v.z),
      sunlit, visible: sunlit && dark
    });
  }

  const dt = Math.min(60, Math.max(0, (now - state.aircraftAt) / 1000));
  if (state.aircraftAt) for (const a of state.aircraft) {
    const p = advance(a, dt), L = lookGd(p.lat, p.lon, p.altKm);
    if (L.el < 0) continue;
    const q = advance(a, dt + 15), L2 = lookGd(q.lat, q.lon, q.altKm);
    objs.push({
      id: 'air:' + a.id, kind: 'air', name: a.call || a.reg || a.id.toUpperCase(), az: L.az, el: L.el, az2: L2.az, el2: L2.el,
      range: L.range, ac: a, altFt: a.altFt + (a.vr || 0) * dt / 60
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
  const cx = W / 2, cy = W / 2, R = W / 2 - 26;
  const rot = state.compass ? state.heading : state.rot, sgn = state.flip ? 1 : -1;
  const P = (az, el) => { const r = (90 - el) / 90 * R, th = (az - rot) * D2R; return { x: cx + sgn * r * Math.sin(th), y: cy - r * Math.cos(th) }; };

  const k = Math.max(0, Math.min(1, ((state.sunAlt ?? -30) + 16) / 22));
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  g.addColorStop(0, `rgb(${mix([6, 10, 24], [40, 92, 160], k)})`);
  g.addColorStop(1, `rgb(${mix([14, 22, 44], [120, 170, 215], k)})`);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(160,180,210,.28)'; ctx.lineWidth = 1;
  for (const el of [0, 30, 60]) { ctx.beginPath(); ctx.arc(cx, cy, (90 - el) / 90 * R, 0, 7); ctx.stroke(); }
  ctx.font = '11px system-ui'; ctx.fillStyle = 'rgba(160,180,210,.6)'; ctx.textAlign = 'left';
  ctx.fillText('30°', cx + 3, cy - (60 / 90) * R + 12); ctx.fillText('60°', cx + 3, cy - (30 / 90) * R + 12);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '600 13px system-ui';
  [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([t, az]) => {
    const p = P(az, -9); ctx.fillStyle = t === 'N' ? '#ff8a80' : '#aab6cc'; ctx.fillText(t, p.x, p.y);
  });
  ctx.textBaseline = 'alphabetic';

  state.hits = [];
  const F = state.filters, sel = state.sel;
  const label = (o, p, dx = 8, dy = -8, col = '#cfd8e8') => { ctx.fillStyle = col; ctx.textAlign = 'left'; ctx.font = '11px system-ui'; ctx.fillText(o.name, p.x + dx, p.y + dy); };
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
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(ang); ctx.fillStyle = COL.air;
    ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4.5, 3.8); ctx.lineTo(-2, 0); ctx.lineTo(-4.5, -3.8); ctx.closePath(); ctx.fill(); ctx.restore();
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
function loop() { if (state.dirty) draw(); requestAnimationFrame(loop); }

/* ---------- UI ---------- */
function moonName() {
  try { return moonPhaseName(Astronomy.MoonPhase(new Date())); } catch { return 'Moon'; }
}
function renderHud() {
  const parts = [];
  if (state.sunAlt != null) parts.push(`${sunPhase(state.sunAlt)} · Sun ${Math.round(state.sunAlt)}°`);
  if (state.moonIllum != null) parts.push(`${moonName()} ${Math.round(state.moonIllum * 100)}%`);
  if (state.cloud != null) parts.push(`Cloud ${Math.round(state.cloud)}%`);
  $('#hud').innerHTML = parts.map(esc).join('<br>');
}
function renderChips() {
  const c = { air: 0, sat: 0, sky: 0, met: 0, star: 0 }, vis = state.objs.filter(o => o.kind === 'sat' && o.visible).length;
  for (const o of state.objs) { const k = o.kind === 'body' ? 'sky' : o.kind; if (k in c && (o.el >= 0 || k === 'met')) c[k]++; }
  const defs = [['air', 'Aircraft', COL.air, c.air], ['sat', 'Satellites', COL.sat, c.sat], ['sky', 'Sun · Moon · Planets', '#ffd86b', c.sky], ['met', 'Meteors', COL.met, c.met], ['star', 'Stars', COL.star, c.star]];
  $('#chips').innerHTML = defs.map(([k, n, col, cnt]) => `<button class="chip ${state.filters[k] ? 'on' : ''}" data-f="${k}"><i style="background:${col}"></i>${n} ${cnt}</button>`).join('')
    + (vis ? `<span class="muted" style="align-self:center">${vis} satellite${vis > 1 ? 's' : ''} visible now</span>` : '');
}
function renderStatus() {
  const s = state.status, now = Date.now(), out = [];
  if (s.air) out.push(s.air.err ? '<span class="bad">Aircraft: feed unreachable</span>' : `<span>Aircraft: ${esc(s.air.src)} · ${s.air.n} nearby · ${ago(now - s.air.t)} ago</span>`);
  else out.push('<span>Aircraft: loading…</span>');
  if (s.sat) out.push(s.sat.err ? '<span class="bad">Satellites: data unreachable</span>' : `<span class="${now - s.sat.t > 10 * 864e5 ? 'bad' : ''}">Satellites: ${s.sat.n} tracked · elements ${ago(now - s.sat.t)} old</span>`);
  else out.push('<span>Satellites: loading…</span>');
  $('#status').innerHTML = out.join('');
}
const row = (o, left, right, extra = '') =>
  `<button class="row ${state.sel === o.id ? 'sel' : ''}" data-id="${esc(o.id)}"><span class="dot" style="background:${o.color || COL[o.kind] || '#fff'}"></span><span class="nm">${left}${extra}</span><span class="pos">${right}</span></button>`;
const posTxt = o => `${Math.round(o.el)}° · ${dir16(o.az)} ${Math.round(o.az)}°`;
function renderLists() {
  const F = state.filters, O = state.objs, parts = [];
  if (F.air) {
    const l = O.filter(o => o.kind === 'air').sort((a, b) => a.range - b.range).slice(0, 40);
    parts.push(`<div class="section"><h4>Aircraft overhead (${l.length}${l.length === 40 ? '+' : ''})</h4>${l.map(o =>
      row(o, esc(o.name) + (o.ac.type ? ` <small>${esc(o.ac.type)}</small>` : ''), `${Math.round(o.range)} km · ${posTxt(o)}`)).join('') || '<p class="muted">None above the horizon right now.</p>'}</div>`);
  }
  if (F.sat) {
    const l = O.filter(o => o.kind === 'sat').sort((a, b) => (b.visible - a.visible) || b.el - a.el).slice(0, 40);
    parts.push(`<div class="section"><h4>Satellites above horizon (${l.length}${l.length === 40 ? '+' : ''})</h4>${l.map(o =>
      row(o, esc(o.name), posTxt(o), o.visible ? '<span class="vis">visible</span>' : '')).join('') || '<p class="muted">None yet.</p>'}</div>`);
  }
  if (F.sky) {
    const l = O.filter(o => o.kind === 'body');
    parts.push(`<div class="section"><h4>Sun, Moon & planets</h4>${l.map(o =>
      row(o, esc(o.name) + (o.el < 0 ? ' <small>below horizon</small>' : ''), `${Math.round(o.el)}° · ${dir16(o.az)} ${Math.round(o.az)}°`)).join('')}</div>`);
  }
  if (F.met) {
    const l = state.showerView.filter(s => s.active).concat(state.showerView.filter(s => !s.active).slice(0, 1));
    parts.push(`<div class="section"><h4>Meteor showers</h4>${l.map(s => {
      const o = state.byId.get('met:' + s.n);
      const when = s.active ? (s.peakDelta === 0 ? 'peak today' : s.peakDelta < 0 ? `peak in ${-s.peakDelta} d` : `peak ${s.peakDelta} d ago`) : `starts in ${s.daysTo} d`;
      return o ? row(o, esc(s.n) + ` <small>${when} · ZHR ${s.zhr}</small>`, `radiant ${Math.round(o.el)}°`)
        : `<div class="row" style="cursor:default"><span class="dot" style="background:${COL.met}"></span><span class="nm">${esc(s.n)} <small>${when} · ZHR ${s.zhr}</small></span></div>`;
    }).join('')}</div>`);
  }
  $('#lists').innerHTML = parts.join('');
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
function renderDetail() {
  const el = $('#detail'), o = state.sel && state.byId.get(state.sel);
  if (!o) { el.hidden = true; return; }
  el.hidden = false;
  const kv = (k, v) => v == null || v === '' ? '' : `<dt>${k}</dt><dd>${v}</dd>`;
  let title = esc(o.name), rows = '';
  const here = kv('Sky position', `${Math.round(o.el)}° up · ${dir16(o.az)} (${Math.round(o.az)}°)`);
  if (o.kind === 'air') {
    const a = o.ac;
    title += a.type ? ` <small class="muted">${esc(a.type)}</small>` : '';
    rows = here + kv('Altitude', `${Math.round(o.altFt).toLocaleString()} ft (FL${String(Math.round(o.altFt / 100)).padStart(3, '0')})`)
      + kv('Speed', `${Math.round(a.gs)} kt · ${Math.round(a.gs * 1.852)} km/h`) + kv('Heading', `${Math.round(a.track)}° ${dir16(a.track)}`)
      + kv('Vertical', a.vr ? `${a.vr > 0 ? '+' : ''}${Math.round(a.vr)} ft/min` : 'level') + kv('Distance', `${Math.round(o.range)} km`)
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
  el.innerHTML = `<h3>${title}</h3><dl>${rows}</dl>`;
}
function renderAll() { renderHud(); renderChips(); renderStatus(); renderLists(); renderDetail(); renderPasses(); }

/* ---------- location ---------- */
function setLoc(lat, lon) {
  state.loc = { lat, lon }; lsSet('fg.loc', state.loc);
  $('#locLabel').textContent = `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`;
  $('#sheet').hidden = true;
  state.aircraft = []; state.aircraftAt = 0; state.cloud = null;
  tick(); refreshAircraft(); refreshCloud(); updatePasses(); renderAll();
}
function locate() {
  const msg = $('#sheetMsg');
  if (!navigator.geolocation) { msg.textContent = 'Geolocation is not available — enter coordinates instead.'; return; }
  msg.textContent = 'Locating…';
  navigator.geolocation.getCurrentPosition(
    p => { msg.textContent = ''; setLoc(p.coords.latitude, p.coords.longitude); },
    e => { msg.textContent = e.code === 1 ? 'Permission denied — enter coordinates instead.' : 'Could not get a fix — enter coordinates instead.'; },
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
}
function openSheet() { $('#closeSheet').hidden = !state.loc; $('#sheet').hidden = false; }

/* ---------- compass & interaction ---------- */
function onOri(e) {
  let h = null;
  if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
  else if ((e.absolute === true || e.type === 'deviceorientationabsolute') && e.alpha != null) h = norm360(360 - e.alpha);
  if (h == null) return;
  let d = norm360(h - state.heading + 180) - 180;
  state.heading = norm360(state.heading + d * 0.25); state.dirty = true;
}
async function toggleCompass() {
  if (state.compass) { state.compass = false; $('#compassBtn').classList.remove('on'); state.dirty = true; return; }
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      if (await DeviceOrientationEvent.requestPermission() !== 'granted') throw new Error('permission denied');
    }
    if (!toggleCompass.bound) {
      window.addEventListener('deviceorientationabsolute', onOri, true);
      window.addEventListener('deviceorientation', onOri, true);
      toggleCompass.bound = true;
    }
    state.compass = true; $('#compassBtn').classList.add('on');
    toast('Hold the phone flat and overhead, top edge pointing where you face.');
  } catch (e) { toast('Compass unavailable: ' + e.message); }
}
function bindUI() {
  $('#locBtn').onclick = openSheet;
  $('#geoBtn').onclick = locate;
  $('#sampleBtn').onclick = () => { const s = FarGemsOnboarding.SAMPLE_LOCATION; setLoc(s.lat, s.lon); };
  $('#closeSheet').onclick = () => { $('#sheet').hidden = true; };
  $('#manualForm').onsubmit = e => {
    e.preventDefault();
    const m = $('#manualLoc').value.match(/(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)/);
    const la = m && +m[1], lo = m && +m[2];
    if (!m || Math.abs(la) > 90 || Math.abs(lo) > 180) { $('#sheetMsg').textContent = 'Use “latitude, longitude”, e.g. 22.57, 88.36'; return; }
    setLoc(la, lo);
  };
  $('#compassBtn').onclick = toggleCompass;
  $('#flipBtn').onclick = () => { state.flip = !state.flip; $('#flipBtn').textContent = state.flip ? 'E/W: mirrored' : 'E/W: chart'; state.dirty = true; };
  $('#northBtn').onclick = () => { state.rot = 0; state.dirty = true; };
  $('#chips').onclick = e => { const b = e.target.closest('[data-f]'); if (b) { state.filters[b.dataset.f] = !state.filters[b.dataset.f]; state.dirty = true; renderChips(); renderLists(); } };
  $('#lists').onclick = e => { const b = e.target.closest('[data-id]'); if (b) { state.sel = b.dataset.id; state.dirty = true; renderLists(); renderDetail(); $('#detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } };
  const cv = $('#sky'); let down = null;
  cv.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, moved: false }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => {
    if (!down) return; const dx = e.clientX - down.x;
    if (Math.abs(dx) > 6) down.moved = true;
    if (down.moved && !state.compass) { state.rot = norm360(state.rot + (state.flip ? -1 : 1) * dx * 0.4); down.x = e.clientX; state.dirty = true; }
  });
  cv.addEventListener('pointerup', e => {
    if (down && !down.moved) {
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      let best = null, bd = 1e9;
      for (const h of state.hits) { const d = Math.hypot(h.x - x, h.y - y); if (d < h.r && d < bd) { best = h; bd = d; } }
      state.sel = best ? best.id : null; state.dirty = true; renderLists(); renderDetail();
    }
    down = null;
  });
  window.addEventListener('resize', () => { state.dirty = true; });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshAircraft(); tick(); } });
}

/* ---------- timers ---------- */
function tick() { try { computeSky(new Date()); } catch (e) { console.error(e); } }
function start() {
  bindUI();
  if (typeof satellite === 'undefined' || typeof Astronomy === 'undefined') {
    $('#status').innerHTML = '<span class="bad">Sky libraries failed to load. Check your connection and reload.</span>';
  }
  const saved = lsGet('fg.loc');
  if (saved && typeof saved.lat === 'number' && typeof saved.lon === 'number') setLoc(saved.lat, saved.lon); else openSheet();
  // Landing page already asked for the compass; turn it on without a second prompt.
  try { if (window.FarGemsOnboarding && FarGemsOnboarding.shouldAutoEnableCompass(localStorage)) toggleCompass(); } catch { /* storage blocked */ }
  refreshSats();
  setInterval(() => { tick(); }, 1000);
  setInterval(renderAll, 2000);
  setInterval(refreshAircraft, 10000);
  setInterval(refreshCloud, 15 * 60e3);
  setInterval(refreshSats, 3600e3);
  setInterval(updatePasses, 20 * 60e3);
  requestAnimationFrame(loop);
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => { /* optional */ });
}
start();
})();
