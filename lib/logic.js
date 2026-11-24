/* FarGems logic: pure, DOM-free helpers extracted from app.js so they can be tested.
 * Browser: plain <script> that exposes window.FarGemsLogic.
 * Node: require('../lib/logic.js') for tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FarGemsLogic = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const D2R = Math.PI / 180;
  const DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const MOON_NAMES = ['New Moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full Moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];

  // Escape text for safe insertion into innerHTML.
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Normalise an angle to [0, 360).
  function norm360(a) {
    return ((a % 360) + 360) % 360;
  }

  // 16-point compass name for an azimuth in degrees.
  function dir16(az) {
    return DIRS[Math.round(norm360(az) / 22.5) % 16];
  }

  // Day-of-year-like index in a leap year (2001), so month/day pairs compare across the year.
  function md(m, d) {
    return (Date.UTC(2001, m - 1, d) - Date.UTC(2001, 0, 1)) / 864e5;
  }

  // Meteor shower status for a given date. `showers` uses the app's table shape:
  // { n, s:[m,d] start, e:[m,d] end, p:[m,d] peak, ra, dec, zhr }.
  function showerView(showers, now) {
    const t = md(now.getMonth() + 1, now.getDate());
    return showers.map((sh) => {
      const s = md(...sh.s), e = md(...sh.e);
      const active = s <= e ? (t >= s && t <= e) : (t >= s || t <= e);
      let peak = t - md(...sh.p);
      if (peak > 182) peak -= 365;
      if (peak < -182) peak += 365;
      return { ...sh, active, daysTo: (s - t + 365) % 365, peakDelta: Math.round(peak) };
    }).sort((a, b) => (b.active - a.active) || a.daysTo - b.daysTo);
  }

  // Sun altitude (deg) to a twilight label.
  function sunPhase(a) {
    if (a == null) return '';
    if (a > 0) return 'Day';
    if (a > -6) return 'Civil twilight';
    if (a > -12) return 'Nautical twilight';
    if (a > -18) return 'Astronomical twilight';
    return 'Night';
  }

  // Moon phase name from the ecliptic elongation in degrees (astronomy-engine's MoonPhase).
  function moonPhaseName(deg) {
    return MOON_NAMES[Math.floor(((deg + 22.5) % 360) / 45)];
  }

  // Elapsed milliseconds as a short label: 45s, 12m, 3h, 2d.
  function ago(ms) {
    const s = Math.round(ms / 1000);
    if (s < 90) return s + 's';
    if (s < 5400) return Math.round(s / 60) + 'm';
    if (s < 172800) return Math.round(s / 3600) + 'h';
    return Math.round(s / 86400) + 'd';
  }

  // Interpolate two RGB triples by k in [0,1].
  function mix(a, b, k) {
    return a.map((v, i) => Math.round(v + (b[i] - v) * k));
  }

  // Parse an adsb.lol / airplanes.live v2 payload into aircraft records above 150 ft.
  function parseV2(j) {
    const list = j.ac || j.aircraft || [];
    return list.filter((a) => typeof a.lat === 'number' && typeof a.lon === 'number').map((a) => ({
      id: String(a.hex || '').toLowerCase(), call: (a.flight || '').trim(), reg: a.r || '', type: a.t || '',
      lat: a.lat, lon: a.lon,
      altFt: typeof a.alt_baro === 'number' ? a.alt_baro : (a.alt_baro === 'ground' ? 0 : (typeof a.alt_geom === 'number' ? a.alt_geom : null)),
      gs: typeof a.gs === 'number' ? a.gs : 0, track: typeof a.track === 'number' ? a.track : 0,
      vr: a.baro_rate ?? a.geom_rate ?? 0,
    })).filter((a) => a.altFt != null && a.altFt > 150 && a.id);
  }

  // Parse an OpenSky /states/all payload. Units: metres, m/s, converted to ft, kt, ft/min.
  function parseOpenSky(j) {
    return (j.states || []).filter((s) => s[6] != null && s[5] != null && !s[8]).map((s) => ({
      id: String(s[0]), call: (s[1] || '').trim(), reg: '', type: '', lat: s[6], lon: s[5],
      altFt: (s[13] ?? s[7] ?? 0) * 3.28084, gs: (s[9] || 0) * 1.94384, track: s[10] || 0, vr: (s[11] || 0) * 196.85,
    })).filter((a) => a.altFt > 150);
  }

  // Bounding-box URL for OpenSky around a point, radius in nautical miles.
  function openSkyUrl(la, lo, r) {
    const dLat = r / 60, dLon = r / (60 * Math.max(0.2, Math.cos(la * D2R)));
    return `https://opensky-network.org/api/states/all?lamin=${(la - dLat).toFixed(3)}&lomin=${(lo - dLon).toFixed(3)}&lamax=${(+la + dLat).toFixed(3)}&lomax=${(+lo + dLon).toFixed(3)}`;
  }

  // Dead-reckon an aircraft forward by dt seconds (track and ground speed, vertical rate).
  function advance(a, dt) {
    const dist = (a.gs || 0) * dt / 3600, tr = (a.track || 0) * D2R;
    return {
      lat: a.lat + dist * Math.cos(tr) / 60,
      lon: a.lon + dist * Math.sin(tr) / (60 * Math.max(0.2, Math.cos(a.lat * D2R))),
      altKm: Math.max(0, a.altFt + (a.vr || 0) * dt / 60) * 0.0003048,
    };
  }

  // Parse a CelesTrak 3-line TLE feed. `makeRec(l1, l2)` builds the satellite record and may throw
  // or return an object with `error` set, in which case the entry is skipped.
  function parseTLE(text, group, makeRec) {
    const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
    const out = [];
    for (let i = 0; i + 2 < lines.length; i++) {
      if (lines[i + 1].startsWith('1 ') && lines[i + 2].startsWith('2 ')) {
        try {
          const rec = makeRec(lines[i + 1], lines[i + 2]);
          if (!rec.error) out.push({ name: lines[i].replace(/^0 /, '').trim(), norad: parseInt(lines[i + 1].slice(2, 7), 10), rec, group });
        } catch { /* bad element set */ }
        i += 2;
      }
    }
    return out;
  }

  /* ---------- sky map zoom and pan ---------- */
  // The view is { zoom, panX, panY }: zoom in [1, 6]; pan in canvas pixels from the centred dome.
  const MIN_ZOOM = 1, MAX_ZOOM = 6;

  function clampZoom(z) {
    if (!Number.isFinite(z)) return MIN_ZOOM;
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
  }

  function resetView() {
    return { zoom: 1, panX: 0, panY: 0 };
  }

  // Zoom to newZoom keeping the canvas point (px, py) under the same spot on the dome.
  // W is the canvas width in pixels; the dome's base radius is W/2 - 26.
  function zoomAt(view, newZoom, px, py, W) {
    const z0 = view.zoom, z1 = clampZoom(newZoom);
    const c0x = W / 2 + view.panX, c0y = W / 2 + view.panY;
    const k = z1 / z0;
    const c1x = px - (px - c0x) * k, c1y = py - (py - c0y) * k;
    return { zoom: z1, panX: c1x - W / 2, panY: c1y - W / 2 };
  }

  // Pan by (dx, dy) pixels. Only when zoomed in: at 1x a drag rotates the sky, as before.
  function panBy(view, dx, dy, W) {
    if (view.zoom <= MIN_ZOOM) return { ...view };
    const limit = W * 1.5;
    const clamp = (v) => Math.min(limit, Math.max(-limit, v));
    return { zoom: view.zoom, panX: clamp(view.panX + dx), panY: clamp(view.panY + dy) };
  }

  // Zoom factor from a change in the distance between two fingers.
  function pinchFactor(prevDist, nextDist) {
    if (!(prevDist > 0) || !(nextDist > 0)) return 1;
    return nextDist / prevDist;
  }

  /* ---------- temperature units ---------- */
  function cToF(c) { return c * 9 / 5 + 32; }
  function fToC(f) { return (f - 32) * 5 / 9; }

  // "21°C" or "71°F". Missing or non-numeric values show an en dash.
  function formatTemp(c, unit = 'C') {
    if (!Number.isFinite(c)) return '–';
    if (unit === 'F') return `${Math.round(cToF(c))}°F`;
    return `${Math.round(c)}°C`;
  }

  // Only 'C' and 'F' are valid. Anything else falls back to Celsius.
  function parseUnit(u) { return u === 'F' ? 'F' : 'C'; }

  // The other unit. An unknown value counts as Celsius, so the next unit is Fahrenheit.
  function nextUnit(u) { return parseUnit(u) === 'C' ? 'F' : 'C'; }

  // URL of the aircraft proxy for a point, or null when no proxy is configured.
  function aircraftProxyUrl(base, lat, lon, r = 150) {
    if (!base) return null;
    return base + (base.includes('?') ? '&' : '?') + 'lat=' + Number(lat).toFixed(3) + '&lon=' + Number(lon).toFixed(3) + '&r=' + r;
  }

  /* ---------- layers ---------- */
  const LAYER_KEYS = ['air', 'sat', 'sky', 'met', 'star', 'grid', 'labels', 'radar'];
  const LAYER_LABELS = {
    air: 'Aircraft', sat: 'Satellites', sky: 'Sun, Moon & planets', met: 'Meteor radiants', star: 'Stars',
    grid: 'Altitude rings & compass', labels: 'Names', radar: 'Radar sweep',
  };

  // Default layer state. The radar sweep starts off when the visitor prefers reduced motion.
  function defaultLayers(reducedMotion = false) {
    return { air: true, sat: true, sky: true, met: true, star: true, grid: true, labels: true, radar: !reducedMotion };
  }

  // Layer choices from storage. Only known keys with boolean values are applied; everything else
  // keeps its default. A missing or corrupt value gives the defaults.
  function loadLayers(raw, reducedMotion = false) {
    const base = defaultLayers(reducedMotion);
    let saved = null;
    try { saved = JSON.parse(raw); } catch { return base; }
    if (!saved || typeof saved !== 'object') return base;
    for (const k of LAYER_KEYS) if (typeof saved[k] === 'boolean') base[k] = saved[k];
    return base;
  }

  // Flip one layer. Unknown keys leave the state unchanged and return a copy.
  function toggleLayer(layers, key) {
    if (!LAYER_KEYS.includes(key)) return { ...layers };
    return { ...layers, [key]: !layers[key] };
  }

  /* ---------- radar sweep ---------- */
  // Advance the sweep angle (degrees, [0,360)) by elapsed time. One full turn takes `periodMs`.
  // Long gaps (a hidden tab) are clamped so the sweep never jumps a whole turn at once.
  function sweepAngle(prevDeg, dtMs, periodMs = 4000) {
    if (!(periodMs > 0)) return norm360(prevDeg);
    const dt = Math.min(Math.max(dtMs || 0, 0), 250);
    return norm360(prevDeg + 360 * dt / periodMs);
  }

  // Fan of thin slices trailing the sweep line, from the newest (at `theta`) to the oldest.
  // Each slice: { from, to } in degrees and alpha, which fades linearly to zero.
  function sweepWedge(theta, spanDeg = 60, steps = 24) {
    const out = [];
    for (let i = 0; i < steps; i++) {
      out.push({
        from: norm360(theta - spanDeg * (i + 1) / steps),
        to: norm360(theta - spanDeg * i / steps),
        alpha: 0.32 * (1 - i / steps),
      });
    }
    return out;
  }

  return {
    D2R, DIRS, esc, norm360, dir16, md, showerView, sunPhase, moonPhaseName, ago, mix, parseV2, parseOpenSky, openSkyUrl, advance, parseTLE,
    LAYER_KEYS, LAYER_LABELS, defaultLayers, toggleLayer, loadLayers, sweepAngle, sweepWedge,
    cToF, fToC, formatTemp, parseUnit, nextUnit,
    aircraftProxyUrl,
    clampZoom, resetView, zoomAt, panBy, pinchFactor,
  };
});
