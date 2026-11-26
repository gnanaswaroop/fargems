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

  // Distance in km with thousands separators; very large distances in astronomical units.
  function formatDistance(km) {
    if (!Number.isFinite(km)) return 'distance unknown';
    if (km >= 1e8) return (km / 149597870.7).toFixed(1) + ' AU';
    return Math.round(km).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' km';
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
    D2R, DIRS, esc, norm360, dir16, md, showerView, sunPhase, moonPhaseName, ago, mix, parseV2, parseOpenSky, openSkyUrl, advance, parseTLE,
    LAYER_KEYS, LAYER_LABELS, defaultLayers, toggleLayer, loadLayers, sweepAngle, sweepWedge,
    cToF, fToC, formatTemp, parseUnit, nextUnit,
    aircraftProxyUrl,
    EARTH_KM, DEFAULT_FLIGHT_RANGE_KM, MIN_FLIGHT_RANGE_KM, MAX_FLIGHT_RANGE_KM, MIN_ELEVATION_DEG, horizonKm, isVisibleFlight, parseFlightRange, parseVisOnly,
    PLANE_GLYPH, planeRotation, typeOf, wikiTitle, wikiUrl, wikiSummaryUrl, wikiBlurb, locateProxyUrl, parseIpLocation, parsePins, togglePin, pinFirst, shareText, shortLabel, routeProxyUrl, tleProxyUrl, routeEntryFresh, describeAirport, bearingTo, distanceKm,
    clampZoom, resetView, zoomAt, panBy, pinchFactor,
    describeDirection, sortNearest, formatDistance, swipeDirection,
  };
});
