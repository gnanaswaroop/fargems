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
  // How long until something starts, for a pass that has not begun: "now", "in 25 min", "in 3 h 5 min", "in 2 days".
  function untilText(ms) {
    if (!Number.isFinite(ms)) return '';
    const min = Math.round(ms / 60000);
    if (min <= 0) return 'now';
    if (min < 90) return 'in ' + min + ' min';
    if (min < 2880) { const h = Math.floor(min / 60), m = min % 60; return 'in ' + h + ' h' + (m ? ' ' + m + ' min' : ''); }
    return 'in ' + Math.round(min / 1440) + ' days';
  }
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
      // A missing speed or direction stays missing (null), it is not turned into 0: a flight with no direction is not a flight
      // heading north. The direction may come under another name; seen_pos is how old the position is, in seconds.
      gs: typeof a.gs === 'number' ? a.gs : null,
      track: [a.track, a.true_heading, a.mag_heading].find((v) => typeof v === 'number' && Number.isFinite(v)) ?? null,
      ageS: typeof a.seen_pos === 'number' && a.seen_pos >= 0 ? a.seen_pos : 0,
      vr: a.baro_rate ?? a.geom_rate ?? 0,
    })).filter((a) => a.altFt != null && a.altFt > 150 && a.id);
  }

  // Parse an OpenSky /states/all payload. Units: metres, m/s, converted to ft, kt, ft/min.
  function parseOpenSky(j) {
    return (j.states || []).filter((s) => s[6] != null && s[5] != null && !s[8]).map((s) => ({
      id: String(s[0]), call: (s[1] || '').trim(), reg: '', type: '', lat: s[6], lon: s[5],
      altFt: (s[13] ?? s[7] ?? 0) * 3.28084, gs: typeof s[9] === 'number' ? s[9] * 1.94384 : null, track: typeof s[10] === 'number' ? s[10] : null, vr: (s[11] || 0) * 196.85,
      ageS: typeof j.time === 'number' && typeof s[3] === 'number' ? Math.max(0, j.time - s[3]) : 0,
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

  // Does this flight have a direction and a speed worth drawing an arrow for? (A plane that is not known to be moving is
  // drawn as a plain dot, never as a plane pointing some way it is not going.)
  function hasCourse(a) {
    return !!a && Number.isFinite(a.track) && Number.isFinite(a.gs) && a.gs > 20;
  }

  // Settle a flight's direction and speed using where it was at the last poll. A direction or speed that is missing is taken
  // from the movement (when it moved at least 0.15 nm over 4 seconds or more), and a reported direction that is far from the
  // way it plainly moved (over 1 nm) is replaced by the way it moved. prev and cur are { lat, lon, track, gs }.
  function reconcileCourse(prev, cur, dtSec) {
    let track = Number.isFinite(cur.track) ? cur.track : null, gs = Number.isFinite(cur.gs) ? cur.gs : null;
    if (prev && dtSec >= 4) {
      const nm = distanceKm(prev.lat, prev.lon, cur.lat, cur.lon) / 1.852;
      if (nm >= 0.15) {
        const seen = bearingTo(prev.lat, prev.lon, cur.lat, cur.lon), seenGs = nm / (dtSec / 3600);
        if (track == null) track = seen;
        else if (nm >= 1 && Math.abs(norm360(track - seen + 180) - 180) > 45) track = seen;
        if (gs == null) gs = seenGs;
      }
    }
    return { track, gs };
  }

  // A new poll puts a flight where it really is, which can be a little away from where the dead reckoning had drawn it. Rather
  // than jump, the drawn position starts at the old place and slides to the new one over tauMs. corr is { dLat, dLon, at }.
  function applyCorrection(pos, corr, nowMs, tauMs = 20000) {
    if (!corr) return pos;
    const f = Math.max(0, 1 - (nowMs - corr.at) / tauMs);
    return f <= 0 ? pos : { ...pos, lat: pos.lat + corr.dLat * f, lon: pos.lon + corr.dLon * f };
  }

  /* ---------- the path an object follows ---------- */
  // Follow an object forward in time. positionAt(seconds) gives { az, el } (or null). Points are kept from where the object is
  // above minEl until it goes below it. skipLeading skips an object that is still below minEl (it will come up later). Points
  // on a whole hour carry hr (1, 2, ...) for the tick marks.
  function samplePath(positionAt, { stepS = 60, maxS = 3600, minEl = 0, skipLeading = true } = {}) {
    const pts = [];
    for (let s = 0; s <= maxS; s += stepS) {
      const p = positionAt(s);
      if (!p || !Number.isFinite(p.az) || !Number.isFinite(p.el)) continue;
      if (p.el < minEl) { if (pts.length || !skipLeading) break; continue; }
      const pt = { az: norm360(p.az), el: p.el, s };
      if (s > 0 && s % 3600 === 0) pt.hr = s / 3600;
      pts.push(pt);
    }
    return pts;
  }
  // The largest angle (degrees) between the first point of a path and any other, along the sky.
  function pathSpanDeg(pts) {
    if (!pts || pts.length < 2) return 0;
    const v = (p) => { const a = p.az * D2R, e = p.el * D2R; return [Math.cos(e) * Math.sin(a), Math.cos(e) * Math.cos(a), Math.sin(e)]; };
    const a = v(pts[0]); let best = 0;
    for (const p of pts) { const b = v(p), d = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) / D2R; if (d > best) best = d; }
    return best;
  }
  // Does it really move across the sky? A geostationary satellite stays within a degree or so, so it has no path to show.
  function isMoving(pts, minDeg = 2) { return pathSpanDeg(pts) >= minDeg; }

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

  /* ---------- nearby list ---------- */
  // "NE · 30° up", "S · 5° below the horizon", "N · overhead". With a heading (degrees, from north),
  // it adds where to turn: "ahead", "to your right", "behind", "to your left".
  function describeDirection(az, alt, heading = null) {
    if (!Number.isFinite(az) || !Number.isFinite(alt)) return '–';
    const point = dir16(az);
    let height;
    if (alt >= 85) height = 'overhead';
    else if (alt < 0) height = Math.round(-alt) + '° below the horizon';
    else height = Math.round(alt) + '° up';
    let turn = '';
    if (Number.isFinite(heading)) {
      const rel = norm360(az - heading);
      if (rel < 22.5 || rel >= 337.5) turn = 'ahead';
      else if (rel < 157.5) turn = 'to your right';
      else if (rel < 202.5) turn = 'behind';
      else turn = 'to your left';
    }
    return [point, height, turn].filter(Boolean).join(' · ');
  }

  // A copy of the list, nearest first. Items without a distance go last.
  function sortNearest(list) {
    return list.slice().sort((a, b) => {
      const da = a.distKm, db = b.distKm;
      if (da == null && db == null) return 0;
      if (da == null) return 1;
      if (db == null) return -1;
      return da - db;
    });
  }

  // A distance in km, in the visitor's units. Near things get the full number with thousands separators. Space is big:
  // from a million km on, the default is a short form ("149.6 million km"), and the visitor can choose astronomical
  // units or the time light takes to arrive ('au', 'light') instead.
  const AU_KM = 149597870.7, LIGHT_KM_PER_S = 299792.458, FAR_KM = 1e6;
  function formatDistance(km, units, far) {
    if (!Number.isFinite(km)) return 'distance unknown';
    if (km >= FAR_KM) {
      if (far === 'au') return (km / AU_KM).toFixed(km / AU_KM < 10 ? 2 : 1) + ' AU';
      if (far === 'light') return lightTimeText(km) + ' by light';
      return compactLength(km, units);
    }
    return lengthText(km, units);
  }
  function parseFar(raw) { return raw === 'au' || raw === 'light' ? raw : 'units'; }
  // A very long length given in km, as "149.6 million km", "93.0 million mi" or "4.5 billion km".
  function compactLength(km, units) {
    const v = units === 'imperial' ? km / 1.609344 : units === 'aviation' ? km / 1.852 : km;
    const unit = units === 'imperial' ? 'mi' : units === 'aviation' ? 'nm' : 'km';
    if (v >= 1e9) return (v / 1e9).toFixed(1) + ' billion ' + unit;
    return (v / 1e6).toFixed(1) + ' million ' + unit;
  }
  // How long light takes to cross a distance given in km: "1.3 s", "8 min 20 s", "4 h 12 min".
  function lightTimeText(km) {
    const t = km / LIGHT_KM_PER_S;
    if (!(t >= 0)) return '';
    if (t < 10) return t.toFixed(1) + ' s';
    if (t < 60) return Math.round(t) + ' s';
    if (t < 3600) { let m = Math.floor(t / 60), sec = Math.round(t - m * 60); if (sec === 60) { m++; sec = 0; } return m + ' min' + (sec ? ' ' + sec + ' s' : ''); }
    let h = Math.floor(t / 3600), min = Math.round((t - h * 3600) / 60); if (min === 60) { h++; min = 0; }
    return h + ' h' + (min ? ' ' + min + ' min' : '');
  }

  /* ---------- units: metric, imperial or aviation ---------- */
  const KM_PER_MI = 1.609344, KM_PER_NM = 1.852, KMH_PER_KT = 1.852, MPH_PER_KT = 1.15078, FT_PER_M = 3.28084;
  const groupDigits = (n) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  // The saved choice, or by the visitor's language when nothing is saved: miles and mph where those are the habit.
  function parseUnits(raw, locale) {
    if (raw === 'metric' || raw === 'imperial' || raw === 'aviation') return raw;
    return /^en-(US|LR)\b|^my\b/i.test(String(locale || '')) ? 'imperial' : 'metric';
  }
  // A length that is given in km: km, miles or nautical miles.
  function lengthText(km, units) {
    if (units === 'imperial') return groupDigits(km / KM_PER_MI) + ' mi';
    if (units === 'aviation') return groupDigits(km / KM_PER_NM) + ' nm';
    return groupDigits(km) + ' km';
  }
  // A height that is given in feet: metres, or feet (imperial and aviation).
  function altitudeText(ft, units) {
    return units === 'metric' || units == null ? groupDigits(ft / FT_PER_M) + ' m' : groupDigits(ft) + ' ft';
  }
  // A speed that is given in knots: km/h, mph or knots.
  function speedText(kt, units) {
    if (units === 'imperial') return groupDigits(kt * MPH_PER_KT) + ' mph';
    if (units === 'aviation') return groupDigits(kt) + ' kt';
    return groupDigits(kt * KMH_PER_KT) + ' km/h';
  }

  // 'left' or 'right' for a clear horizontal swipe; null for short or mostly vertical moves (scrolling).
  function swipeDirection(dx, dy, min = 60) {
    if (Math.abs(dx) < min || Math.abs(dx) < 1.5 * Math.abs(dy)) return null;
    return dx < 0 ? 'left' : 'right';
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
    return base + (base.includes('?') ? '&' : '?') + 'lat=' + Number(lat).toFixed(2) + '&lon=' + Number(lon).toFixed(2) + '&r=' + r; // about 1 km: the relay uses cells of 0.25 degrees anyway
  }

  /* ---------- flights you can actually see ---------- */
  const EARTH_KM = 6371;
  // How far away (km along the ground) a flight can be and still be shown. Kept small by default so the radar
  // shows what is close enough to spot. The visitor can change it in settings.
  const DEFAULT_FLIGHT_RANGE_KM = 25, MIN_FLIGHT_RANGE_KM = 1, MAX_FLIGHT_RANGE_KM = 100;
  // Buildings, trees and haze hide anything lower than this above the horizon.
  const MIN_ELEVATION_DEG = 5;

  // Geometric line-of-sight distance (km along the ground) from sea level to an object at altKm.
  function horizonKm(altKm) {
    const h = Math.max(0, Number(altKm) || 0);
    return Math.sqrt(2 * EARTH_KM * h + h * h);
  }

  // True when a flight at this elevation (deg) and ground distance (km from you, measured along the ground, so a
  // jet straight overhead counts as 0 km) is close enough and high enough in the sky to see.
  function isVisibleFlight(elDeg, groundKm, opts = {}) {
    const minEl = opts.minElevation ?? MIN_ELEVATION_DEG, maxKm = opts.maxRangeKm ?? DEFAULT_FLIGHT_RANGE_KM;
    return Number.isFinite(elDeg) && Number.isFinite(groundKm) && elDeg >= minEl && groundKm <= maxKm;
  }

  // The farthest-flight setting: kilometres, from the stored text. Missing or invalid gives the default; the
  // number is kept between the minimum and maximum.
  function parseFlightRange(raw) {
    const n = typeof raw === 'string' && raw.trim() === '' ? NaN : Number(raw);
    if (raw == null || !Number.isFinite(n)) return DEFAULT_FLIGHT_RANGE_KM;
    return Math.min(MAX_FLIGHT_RANGE_KM, Math.max(MIN_FLIGHT_RANGE_KM, Math.round(n)));
  }

  // The "only flights I can see" choice. On unless the visitor switched it off ('0').
  function parseVisOnly(raw) {
    return raw !== '0';
  }

  // Whether the camera view opens by itself when the phone is raised. On unless the visitor turned it off.
  function parseAutoAr(raw) {
    return raw !== '0';
  }

  // The object after (or before) the selected one, going around the sky by direction, for keyboard use.
  function stepObject(objs, selId, delta) {
    const list = (objs || []).filter((o) => o && o.el > 0).sort((a, b) => a.az - b.az);
    if (!list.length) return null;
    const i = list.findIndex((o) => o.id === selId);
    if (i < 0) return list[delta < 0 ? list.length - 1 : 0].id;
    return list[(i + delta + list.length) % list.length].id;
  }

  /* ---------- the radar's colours by brightness of the sky ---------- */
  // The radar's background goes from dark blue at night to light blue by day, so text colours that read well on one do not
  // read on the other (grey names on a light blue sky just disappear). k is the brightness, 0 (night) to 1 (day). Every
  // name is drawn light with a dark outline (halo), which reads on any background, and the lines and ring numbers get
  // brighter by day.
  const lerp = (a, b, k) => Math.round(a + (b - a) * k);
  function skyLook(k) {
    const t = Math.max(0, Math.min(1, Number.isFinite(k) ? k : 0));
    const c = (a, b) => 'rgb(' + [0, 1, 2].map((i) => lerp(a[i], b[i], t)).join(',') + ')';
    return {
      halo: 'rgba(4,10,26,0.88)',
      haloWidth: 3,
      star: c([188, 198, 218], [246, 249, 255]),
      ring: c([176, 192, 218], [255, 255, 255]),
      grid: 'rgba(' + [lerp(160, 255, t), lerp(180, 255, t), lerp(210, 255, t)].join(',') + ',' + (0.28 + 0.27 * t).toFixed(2) + ')',
      dotOutline: 'rgba(4,10,26,' + (0.15 + 0.6 * t).toFixed(2) + ')',
    };
  }

  /* ---------- plane icon ---------- */
  // U+2708 with the text variation selector, so browsers draw the plain glyph and not a colour emoji.
  const PLANE_GLYPH = '✈︎';
  // Fonts draw the airplane glyph with its nose pointing up and to the right (45 degrees clockwise from up).
  // Given the on-screen direction of travel in radians (0 = right, y down), return the canvas rotation.
  function planeRotation(travelRad) {
    return travelRad + Math.PI / 4;
  }

  /* ---------- what kind of thing an object is ---------- */
  // { key, label } for an object of the sky list: the key picks its icon, the label is the name of its type.
  function typeOf(o) {
    if (!o) return { key: 'star', label: 'Star' };
    switch (o.kind) {
      case 'air': return { key: 'air', label: 'Aircraft' };
      case 'sat': return /^(ISS|CSS)/.test(o.name || '') ? { key: 'station', label: 'Space station' } : { key: 'sat', label: 'Satellite' };
      case 'body': return o.name === 'Sun' ? { key: 'sun', label: 'Sun' } : o.name === 'Moon' ? { key: 'moon', label: 'Moon' } : { key: 'planet', label: 'Planet' };
      case 'met': return { key: 'met', label: 'Meteor shower' };
      default: return { key: 'star', label: 'Star' };
    }
  }

  /* ---------- station passes: only when there is one to look at ---------- */
  const PASS_LOOKAHEAD_H = 4;
  // The passes worth showing now: one that is under way, or that begins within the next few hours. A pass that is over, or that is
  // further off than that, is left out (the list is hidden when nothing is left). now is milliseconds.
  function passesSoon(passes, now, hours = PASS_LOOKAHEAD_H) {
    return (Array.isArray(passes) ? passes : []).filter((p) => p && Number.isFinite(p.start)
      && (p.end == null || p.end > now) && p.start - now <= hours * 3600e3);
  }

  /* ---------- the details drawn next to the selected object in the camera view ---------- */
  // A few short lines for the callout beside the picked object: first its name (with the aircraft type), then up to three facts.
  // opts: { units, far }. Never more than 4 lines, so the bubble stays small and does not hide what is behind it.
  function arCalloutLines(o, opts) {
    if (!o) return [];
    const units = opts && opts.units, far = opts && opts.far, out = [];
    const title = o.kind === 'air' && o.ac && o.ac.type ? o.name + ' · ' + o.ac.type : String(o.name || '');
    out.push(title);
    const where = Number.isFinite(o.el) && Number.isFinite(o.az) ? Math.round(o.el) + '° up · ' + dir16(o.az) : null;
    if (o.kind === 'air') {
      const airline = o.ac && o.ac.call ? airlineOf(o.ac.call) : null;
      if (airline) out.push(airline);
      const speed = o.ac && o.ac.gs != null ? speedText(o.ac.gs, units) : null, alt = o.altFt != null ? altitudeText(o.altFt, units) : null;
      const fa = [alt, speed].filter(Boolean).join(' · '); if (fa) out.push(fa);
      if (o.range != null) out.push(lengthText(o.range, units) + ' away');
    } else if (o.kind === 'sat') {
      out.push(typeOf(o).label);
      if (o.altKm != null) out.push('Altitude ' + lengthText(o.altKm, units) + (o.range != null ? ' · ' + lengthText(o.range, units) + ' away' : ''));
      out.push(o.visible ? 'Sunlit, visible to the eye' : o.sunlit ? 'Sunlit, sky too bright' : 'In Earth’s shadow');
    } else if (o.kind === 'body') {
      if (o.name === 'Moon' && o.phase != null) out.push(Math.round(o.phase * 100) + '% lit');
      else if (o.name !== 'Sun') out.push(typeOf(o).label + (o.mag != null ? ' · magnitude ' + o.mag.toFixed(1) : ''));
      if (o.distKm != null) out.push(formatDistance(o.distKm, units, far) + ' · light takes ' + lightTimeText(o.distKm));
      if (where) out.push(where);
    } else if (o.kind === 'met') {
      out.push('Meteor shower radiant');
      if (o.shower && o.shower.zhr != null) out.push('Up to ~' + o.shower.zhr + '/hour under dark skies');
      if (where) out.push(where);
    } else {
      out.push(typeOf(o).label);
      if (where) out.push(where);
    }
    return out.slice(0, 4);
  }

  /* ---------- Wikipedia: a page to read about an object ---------- */
  const WIKI_BODIES = { Sun: 'Sun', Moon: 'Moon', Mercury: 'Mercury (planet)', Venus: 'Venus', Mars: 'Mars', Jupiter: 'Jupiter', Saturn: 'Saturn', Uranus: 'Uranus', Neptune: 'Neptune' };
  const WIKI_STARS = { Sirius: 'Sirius', Canopus: 'Canopus', Arcturus: 'Arcturus', Vega: 'Vega', Capella: 'Capella', Rigel: 'Rigel', Procyon: 'Procyon', Betelgeuse: 'Betelgeuse', Altair: 'Altair', Aldebaran: 'Aldebaran', Antares: 'Antares', Spica: 'Spica', Pollux: 'Pollux (star)', Fomalhaut: 'Fomalhaut', Deneb: 'Deneb', Regulus: 'Regulus', Polaris: 'Polaris', Acrux: 'Acrux', 'Alpha Centauri': 'Alpha Centauri' };
  const WIKI_AIRCRAFT = {
    A319: 'Airbus A320 family', A320: 'Airbus A320 family', A321: 'Airbus A320 family', A20N: 'Airbus A320neo family', A21N: 'Airbus A320neo family', A19N: 'Airbus A320neo family',
    A332: 'Airbus A330', A333: 'Airbus A330', A339: 'Airbus A330neo', A343: 'Airbus A340', A346: 'Airbus A340', A359: 'Airbus A350', A35K: 'Airbus A350', A388: 'Airbus A380',
    B737: 'Boeing 737 Next Generation', B738: 'Boeing 737 Next Generation', B739: 'Boeing 737 Next Generation', B73H: 'Boeing 737 Next Generation', B38M: 'Boeing 737 MAX', B39M: 'Boeing 737 MAX',
    B744: 'Boeing 747', B748: 'Boeing 747', B752: 'Boeing 757', B753: 'Boeing 757', B762: 'Boeing 767', B763: 'Boeing 767', B764: 'Boeing 767',
    B772: 'Boeing 777', B77L: 'Boeing 777', B77W: 'Boeing 777', B773: 'Boeing 777', B788: 'Boeing 787 Dreamliner', B789: 'Boeing 787 Dreamliner', B78X: 'Boeing 787 Dreamliner',
    E170: 'Embraer E-Jet family', E175: 'Embraer E-Jet family', E190: 'Embraer E-Jet family', E195: 'Embraer E-Jet family', E290: 'Embraer E-Jet E2 family', E295: 'Embraer E-Jet E2 family',
    CRJ2: 'Bombardier CRJ200', CRJ7: 'Bombardier CRJ700 series', CRJ9: 'Bombardier CRJ700 series', AT72: 'ATR 72', AT75: 'ATR 72', AT76: 'ATR 72', AT43: 'ATR 42', AT45: 'ATR 42',
    DH8C: 'De Havilland Canada Dash 8', DH8D: 'De Havilland Canada Dash 8', C172: 'Cessna 172',
  };
  // The Wikipedia article about an object of the sky list, or null when none is known. Planets, the Sun, the Moon, the
  // bright stars, meteor showers, the space stations and satellite constellations, and common aircraft types.
  function wikiTitle(o) {
    if (!o) return null;
    const name = String(o.name || '');
    switch (o.kind) {
      case 'body': return WIKI_BODIES[name] || null;
      case 'star': return WIKI_STARS[name] || null;
      case 'met': return name || null;
      case 'sat':
        if (/^ISS\b/i.test(name)) return 'International Space Station';
        if (/^(CSS|TIANHE)/i.test(name)) return 'Tiangong space station';
        if (/^STARLINK/i.test(name)) return 'Starlink';
        if (/^ONEWEB/i.test(name)) return 'OneWeb';
        if (/^IRIDIUM/i.test(name)) return 'Iridium satellite constellation';
        if (/^(HST|HUBBLE)/i.test(name)) return 'Hubble Space Telescope';
        return null;
      case 'air': return WIKI_AIRCRAFT[String((o.ac && o.ac.type) || '').toUpperCase()] || null;
      default: return null;
    }
  }
  function wikiUrl(title) { return title ? 'https://en.wikipedia.org/wiki/' + encodeURIComponent(String(title).replace(/ /g, '_')) : null; }
  function wikiSummaryUrl(title) { return 'https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(String(title).replace(/ /g, '_')); }
  // A short piece of an article's opening, ended at a sentence where it can, for the detail card.
  function wikiBlurb(extract, max = 240) {
    const t = String(extract || '').replace(/\s+/g, ' ').trim();
    if (t.length <= max) return t;
    const cut = t.slice(0, max), dot = cut.lastIndexOf('. ');
    return dot > 80 ? cut.slice(0, dot + 1) : cut.replace(/\s+\S*$/, '') + '…';
  }

  /* ---------- rough location from the network (when the visitor has not shared one) ---------- */
  // The address of the relay's /locate, from the aircraft address ( .../aircraft ). Empty when there is no relay.
  function locateProxyUrl(aircraftBase) {
    const b = String(aircraftBase || '').trim();
    if (!/^https?:\/\//i.test(b)) return null;
    return b.replace(/\/aircraft\/?(\?.*)?$/i, '') + '/locate';
  }
  // { lat, lon, label } from the relay's answer, or null when it is not a usable place.
  function parseIpLocation(j) {
    if (!j || typeof j !== 'object') return null;
    const lat = Number(j.lat), lon = Number(j.lon);
    if (j.lat == null || j.lon == null || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    const label = [j.city, j.country].map((x) => String(x || '').trim()).filter(Boolean).join(', ');
    return { lat, lon, label };
  }

  /* ---------- pinned objects ---------- */
  const MAX_PINS = 30;
  function parsePins(raw) {
    try { const a = JSON.parse(raw); return Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x).slice(0, MAX_PINS) : []; } catch { return []; }
  }
  // The list with the key added, or removed when it is there. The newest pin goes first.
  function togglePin(pins, key) {
    const list = Array.isArray(pins) ? pins : [];
    return list.includes(key) ? list.filter((k) => k !== key) : [key, ...list].slice(0, MAX_PINS);
  }
  // Pinned objects first (in the order the list already has), then the rest.
  function pinFirst(items, pins) {
    const set = new Set(pins || []);
    return [...items.filter((o) => set.has(o.id)), ...items.filter((o) => !set.has(o.id))];
  }

  /* ---------- sharing an object ---------- */
  // A few plain sentences about an object as it is seen right now. Nothing about where the visitor is, only where to look.
  function shareText(o, extra) {
    if (!o) return '';
    const t = typeOf(o);
    const where = o.el != null ? Math.round(o.el) + '° above the horizon in the ' + dir16(o.az) + ' (' + Math.round(o.az) + '°)' : '';
    const parts = [o.name + ' (' + t.label.toLowerCase() + ')' + (where ? ' is ' + where + ' right now.' : '.')];
    if (extra) parts.push(extra);
    const w = wikiUrl(wikiTitle(o));
    if (w) parts.push('Read more: ' + w);
    return parts.join(' ');
  }
  // A long name is cut with an ellipsis so it cannot run out of the radar.
  function shortLabel(name, max = 20) {
    const n = String(name == null ? '' : name);
    return n.length <= max ? n : n.slice(0, max - 1).trimEnd() + '…';
  }

  /* ---------- flight route (origin and destination) ---------- */
  // URL of the proxy's route lookup, derived from the aircraft URL ("…/aircraft" becomes "…/route").
  function routeProxyUrl(base, callsign, lat, lon) {
    if (!base || !callsign) return null;
    const path = String(base).split('?')[0].replace(/\/aircraft\/?$/, '/route');
    if (path === String(base).split('?')[0] && !/\/route\/?$/.test(path)) return null;
    return path + '?callsign=' + encodeURIComponent(String(callsign).trim().toUpperCase()); // a route depends on the flight only, so no position is sent
  }

  // URL of the proxy's satellite element sets for a group ("stations" or "visual"), derived from the aircraft URL.
  // The proxy shares one copy between all visitors and has mirrors for when CelesTrak is down.
  function tleProxyUrl(base, group) {
    if (!base || !/^[a-z]+$/.test(String(group))) return null;
    const path = String(base).split('?')[0].replace(/\/aircraft\/?$/, '/tle');
    if (path === String(base).split('?')[0] && !/\/tle\/?$/.test(path)) return null;
    return path + '?group=' + group;
  }

  // Whether a remembered route lookup can be used as it is, or the lookup should be tried again.
  // entry: { state: 'loading' | 'done' | 'failed', at: ms timestamp, data? }. A lookup in progress is waited for,
  // a failed one is retried after a minute (the proxy may have been off), an "unknown route" after ten minutes,
  // and a known route is kept.
  function routeEntryFresh(entry, now, retryFailedMs = 60000, retryUnknownMs = 600000) {
    if (!entry) return false;
    if (entry.state === 'loading') return true;
    const age = now - (entry.at || 0);
    if (entry.state === 'failed') return age < retryFailedMs;
    if (entry.state === 'done') return entry.data && entry.data.destination ? true : age < retryUnknownMs;
    return false;
  }

  /* ---------- the airline of a flight ---------- */
  // The first three letters of a flight number are the airline's ICAO code (AIC144 is Air India 144). Private and military flights
  // (N123AB, a registration) have none, and an airline that is not in this list simply shows no name.
  const AIRLINES = {
    AIC: 'Air India',
    IGO: 'IndiGo',
    SEJ: 'SpiceJet',
    VTI: 'Vistara',
    AXB: 'Air India Express',
    AKJ: 'Akasa Air',
    GOW: 'Go First',
    LLR: 'Alliance Air',
    SDG: 'Star Air',
    FBZ: 'Fly Big',
    JAI: 'Jet Airways',
    ALK: 'SriLankan Airlines',
    PIA: 'Pakistan International',
    BBC: 'Biman Bangladesh',
    RNA: 'Nepal Airlines',
    BHA: 'Buddha Air',
    DRK: 'Drukair',
    MDV: 'Maldivian',
    UAE: 'Emirates',
    QTR: 'Qatar Airways',
    ETD: 'Etihad Airways',
    FDB: 'flydubai',
    ABY: 'Air Arabia',
    GFA: 'Gulf Air',
    OMA: 'Oman Air',
    KAC: 'Kuwait Airways',
    SVA: 'Saudia',
    FAD: 'flyadeal',
    KNE: 'flynas',
    RJA: 'Royal Jordanian',
    MEA: 'Middle East Airlines',
    IRA: 'Iran Air',
    IRM: 'Mahan Air',
    THY: 'Turkish Airlines',
    PGT: 'Pegasus',
    ELY: 'El Al',
    SIA: 'Singapore Airlines',
    TGW: 'Scoot',
    MAS: 'Malaysia Airlines',
    AXM: 'AirAsia',
    XAX: 'AirAsia X',
    AIQ: 'Thai AirAsia',
    THA: 'Thai Airways',
    BKP: 'Bangkok Airways',
    VJC: 'VietJet Air',
    HVN: 'Vietnam Airlines',
    GIA: 'Garuda Indonesia',
    CPA: 'Cathay Pacific',
    CAL: 'China Airlines',
    EVA: 'EVA Air',
    CCA: 'Air China',
    CES: 'China Eastern',
    CSN: 'China Southern',
    CHH: 'Hainan Airlines',
    JAL: 'Japan Airlines',
    ANA: 'All Nippon Airways',
    KAL: 'Korean Air',
    AAR: 'Asiana Airlines',
    PAL: 'Philippine Airlines',
    CEB: 'Cebu Pacific',
    QFA: 'Qantas',
    JST: 'Jetstar',
    VOZ: 'Virgin Australia',
    ANZ: 'Air New Zealand',
    BAW: 'British Airways',
    VIR: 'Virgin Atlantic',
    EZY: 'easyJet',
    RYR: 'Ryanair',
    WZZ: 'Wizz Air',
    NAX: 'Norwegian',
    DLH: 'Lufthansa',
    EWG: 'Eurowings',
    CFG: 'Condor',
    AFR: 'Air France',
    KLM: 'KLM',
    IBE: 'Iberia',
    VLG: 'Vueling',
    TAP: 'TAP Air Portugal',
    ITY: 'ITA Airways',
    SWR: 'Swiss',
    AUA: 'Austrian',
    BEL: 'Brussels Airlines',
    SAS: 'Scandinavian Airlines',
    FIN: 'Finnair',
    ICE: 'Icelandair',
    LOT: 'LOT Polish Airlines',
    AEE: 'Aegean Airlines',
    AFL: 'Aeroflot',
    SBI: 'S7 Airlines',
    AHY: 'Azerbaijan Airlines',
    KZR: 'Air Astana',
    UZB: 'Uzbekistan Airways',
    MSR: 'EgyptAir',
    RAM: 'Royal Air Maroc',
    ETH: 'Ethiopian Airlines',
    KQA: 'Kenya Airways',
    SAA: 'South African Airways',
    RWD: 'RwandAir',
    MAU: 'Air Mauritius',
    UAL: 'United Airlines',
    AAL: 'American Airlines',
    DAL: 'Delta Air Lines',
    SWA: 'Southwest Airlines',
    JBU: 'JetBlue',
    ASA: 'Alaska Airlines',
    NKS: 'Spirit Airlines',
    FFT: 'Frontier Airlines',
    ACA: 'Air Canada',
    WJA: 'WestJet',
    AMX: 'Aeroméxico',
    LAN: 'LATAM Chile',
    TAM: 'LATAM Brasil',
    AVA: 'Avianca',
    CMP: 'Copa Airlines',
    GLO: 'Gol',
    AZU: 'Azul',
    ARG: 'Aerolíneas Argentinas',
    FDX: 'FedEx',
    UPS: 'UPS Airlines',
    DHK: 'DHL Air',
    BOX: 'AeroLogic',
    GTI: 'Atlas Air',
    CLX: 'Cargolux',
    SQC: 'Singapore Airlines Cargo',
    BDA: 'Blue Dart Aviation'
  };
  function airlineOf(callsign) {
    const m = /^([A-Z]{3})\d/.exec(String(callsign || '').trim().toUpperCase());
    return m && AIRLINES[m[1]] ? AIRLINES[m[1]] : null;
  }

  // The two ends of a flight for the card, each as { code, place }: the code is the IATA (or ICAO) code, the place the city
  // (or the airport name when there is no city). A missing end is null.
  function routeStops(route) {
    const stop = (a) => (a ? { code: a.iata || a.icao || '', place: a.city || a.name || '' } : null);
    const from = stop(route && route.origin), to = stop(route && route.destination);
    return from && !(from.code || from.place) ? { from: null, to } : { from, to };
  }

  // "VTZ" style label for an airport: "HYD · Rajiv Gandhi International (Hyderabad)". Null for no airport.
  function describeAirport(a) {
    if (!a) return null;
    const code = a.iata || a.icao || '';
    const name = a.name || '';
    const city = a.city && a.city !== name ? ' (' + a.city + ')' : '';
    const out = [code, name + city].filter((x) => x && x.trim()).join(' · ');
    return out || null;
  }

  // Bearing in degrees (0 = north) from point 1 to point 2, and great-circle distance in km.
  function bearingTo(lat1, lon1, lat2, lon2) {
    const p1 = lat1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
    const y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return norm360(Math.atan2(y, x) / D2R);
  }
  function distanceKm(lat1, lon1, lat2, lon2) {
    const p1 = lat1 * D2R, p2 = lat2 * D2R, dp = p2 - p1, dl = (lon2 - lon1) * D2R;
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
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
    D2R, DIRS, esc, norm360, dir16, md, showerView, sunPhase, moonPhaseName, ago, untilText, mix, parseV2, parseOpenSky, openSkyUrl, advance, parseTLE,
    LAYER_KEYS, LAYER_LABELS, defaultLayers, toggleLayer, loadLayers, sweepAngle, sweepWedge,
    cToF, fToC, formatTemp, parseUnit, nextUnit,
    aircraftProxyUrl,
    EARTH_KM, DEFAULT_FLIGHT_RANGE_KM, MIN_FLIGHT_RANGE_KM, MAX_FLIGHT_RANGE_KM, MIN_ELEVATION_DEG, horizonKm, isVisibleFlight, skyLook, airlineOf, routeStops, AIRLINES, hasCourse, reconcileCourse, applyCorrection, samplePath, pathSpanDeg, isMoving, parseFlightRange, parseVisOnly, parseAutoAr, parseUnits, parseFar, compactLength, lightTimeText, AU_KM, lengthText, altitudeText, speedText, stepObject,
    PLANE_GLYPH, planeRotation, typeOf, passesSoon, arCalloutLines, wikiTitle, wikiUrl, wikiSummaryUrl, wikiBlurb, locateProxyUrl, parseIpLocation, parsePins, togglePin, pinFirst, shareText, shortLabel, routeProxyUrl, tleProxyUrl, routeEntryFresh, describeAirport, bearingTo, distanceKm,
    clampZoom, resetView, zoomAt, panBy, pinchFactor,
    describeDirection, sortNearest, formatDistance, swipeDirection,
  };
});
