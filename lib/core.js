/* FarGems core: pure, DOM-free helpers and static data.
 * Loaded by the browser as a plain script (exposes window.FarGems) and by Node for tests (module.exports). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FarGems = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const DEG = Math.PI / 180;

  // Approximate J2000 positions and magnitudes for bright stars.
  const STARS = [
    ['Sirius', 6.7525, -16.716, -1.46], ['Canopus', 6.3992, -52.696, -0.74],
    ['Arcturus', 14.261, 19.182, -0.05], ['Vega', 18.6156, 38.784, 0.03],
    ['Capella', 5.2782, 45.998, 0.08], ['Rigel', 5.2423, -8.202, 0.13],
    ['Procyon', 7.655, 5.225, 0.34], ['Betelgeuse', 5.9195, 7.407, 0.42],
    ['Achernar', 1.6286, -57.237, 0.46], ['Hadar', 14.0637, -60.373, 0.61],
    ['Altair', 19.8464, 8.868, 0.76], ['Aldebaran', 4.5987, 16.509, 0.85],
    ['Antares', 16.4901, -26.432, 1.06], ['Spica', 13.4199, -11.161, 0.97],
    ['Pollux', 7.7553, 28.026, 1.14], ['Fomalhaut', 22.9608, -29.622, 1.16],
    ['Deneb', 20.6905, 45.28, 1.25], ['Regulus', 10.1395, 11.967, 1.35],
    ['Castor', 7.5767, 31.888, 1.58], ['Polaris', 2.5303, 89.264, 1.98],
  ];

  // Approximate meteor showers: peak month/day, radiant RA (hours), Dec (deg), ZHR.
  const SHOWERS = [
    { name: 'Quadrantids', m: 1, d: 4, ra: 15.3, dec: 49.5, zhr: 120 },
    { name: 'Lyrids', m: 4, d: 22, ra: 18.1, dec: 33.6, zhr: 18 },
    { name: 'Eta Aquariids', m: 5, d: 6, ra: 22.5, dec: -1, zhr: 50 },
    { name: 'Perseids', m: 8, d: 12, ra: 3.1, dec: 58, zhr: 100 },
    { name: 'Orionids', m: 10, d: 21, ra: 6.3, dec: 15.9, zhr: 20 },
    { name: 'Leonids', m: 11, d: 17, ra: 10.1, dec: 21.6, zhr: 15 },
    { name: 'Geminids', m: 12, d: 14, ra: 7.5, dec: 32.5, zhr: 150 },
    { name: 'Ursids', m: 12, d: 22, ra: 14.5, dec: 75.3, zhr: 10 },
  ];

  const TLE_URLS = [
    'https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=tle', // ~100 brightest
    'https://celestrak.org/NORAD/elements/gp.php?CATNUM=25544&FORMAT=tle', // ISS
    'https://celestrak.org/NORAD/elements/gp.php?CATNUM=48274&FORMAT=tle', // Tiangong
  ];

  // 'N', 'NE', ... for an azimuth in degrees (any value; normalised to 0-360).
  function dirName(az) {
    const a = ((az % 360) + 360) % 360;
    return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(a / 45) % 8];
  }

  // Fixed-decimal formatting; non-finite numbers render as an en dash.
  function fmt(n, d = 0) {
    return Number.isFinite(n) ? n.toFixed(d) : '–';
  }

  // Geodetic (WGS84) to ECEF metres.
  function ecef(latDeg, lonDeg, h) {
    const a = 6378137, f = 1 / 298.257223563, e2 = f * (2 - f);
    const p = latDeg * DEG, l = lonDeg * DEG;
    const N = a / Math.sqrt(1 - e2 * Math.sin(p) ** 2);
    return [(N + h) * Math.cos(p) * Math.cos(l), (N + h) * Math.cos(p) * Math.sin(l), (N * (1 - e2) + h) * Math.sin(p)];
  }

  // Topocentric azimuth (0-360, from north), altitude (deg) and slant range (km)
  // from an observer to a target. Heights in metres.
  function lookAngles(lat, lon, obsH, tLat, tLon, tH) {
    const o = ecef(lat, lon, obsH), t = ecef(tLat, tLon, tH);
    const d = [t[0] - o[0], t[1] - o[1], t[2] - o[2]];
    const p = lat * DEG, l = lon * DEG;
    const e = -Math.sin(l) * d[0] + Math.cos(l) * d[1];
    const n = -Math.sin(p) * Math.cos(l) * d[0] - Math.sin(p) * Math.sin(l) * d[1] + Math.cos(p) * d[2];
    const u = Math.cos(p) * Math.cos(l) * d[0] + Math.cos(p) * Math.sin(l) * d[1] + Math.sin(p) * d[2];
    const range = Math.hypot(e, n, u);
    let az = Math.atan2(e, n) / DEG;
    if (az < 0) az += 360;
    return { az, alt: Math.asin(u / range) / DEG, range: range / 1000 };
  }

  // Parse a 3-line-per-object TLE feed. Returns [{name, l1, l2}].
  function parseTLE(text) {
    const lines = String(text).split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
    const out = [];
    for (let i = 0; i + 2 < lines.length; i++) {
      if (lines[i + 1].startsWith('1 ') && lines[i + 2].startsWith('2 ')) {
        out.push({ name: lines[i].trim(), l1: lines[i + 1], l2: lines[i + 2] });
        i += 2;
      }
    }
    return out;
  }

  // NORAD catalogue number from TLE line 1 (columns 3-7).
  function catalogNumber(l1) {
    return l1.substring(2, 7).trim();
  }

  // Days from `now` to the next occurrence of the given month/day (negative if it was within the last 180 days).
  function daysToPeak(m, d, now) {
    const year = now.getUTCFullYear();
    let peak = Date.UTC(year, m - 1, d);
    if ((peak - now.getTime()) / 86400000 < -180) peak = Date.UTC(year + 1, m - 1, d);
    return (peak - now.getTime()) / 86400000;
  }

  return { DEG, STARS, SHOWERS, TLE_URLS, dirName, fmt, ecef, lookAngles, parseTLE, catalogNumber, daysToPeak };
});
