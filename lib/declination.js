/* FarGems: magnetic declination (the angle between magnetic north and true north) from the World Magnetic Model.
 * Phone compasses point at magnetic north, but the sky is worked out from true north, so every compass reading
 * needs this correction. The model data is NOAA's WMM2025 (public domain), valid from 2025 to 2030.
 * declination(lat, lon, date) gives degrees, positive when magnetic north is east of true north. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FarGemsDeclination = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // WMM2025 main field (g, h, nT) and yearly change (gDot, hDot, nT/yr), degree n and order m at index n(n+1)/2 + m.
  const EPOCH = 2025, N_MAX = 12;
  const G = [0,-29351.8,-1410.8,-2556.6,2951.1,1649.3,1361,-2404.1,1243.8,453.6,895,799.5,55.7,-281.1,12.1,-233.2,368.9,187.2,-138.7,-142,20.9,64.4,63.8,76.9,-115.7,-40.9,14.9,-60.7,79.5,-77,-8.8,59.3,15.8,2.5,-11.1,14.2,23.2,10.8,-17.5,2,-21.7,16.9,15,-16.8,0.9,4.6,7.8,3,-0.2,-2.5,-13.1,2.4,8.6,-8.7,-12.9,-1.3,-6.4,0.2,2,-1,-0.6,-0.9,1.5,0.9,-2.7,-3.9,2.9,-1.5,-2.5,2.4,-0.6,-0.1,-0.6,-0.1,1.1,-1,-0.2,2.6,-2,-0.2,0.3,1.2,-1.3,0.6,0.6,0.5,-0.1,-0.4,-0.2,-1.3,-0.7];
  const H = [0,0,4545.4,0,-3133.6,-815.1,0,-56.6,237.5,-549.5,0,278.6,-133.9,212,-375.6,0,45.4,220.2,-122.9,43,106.1,0,-18.4,16.8,48.8,-59.8,10.9,72.7,0,-48.9,-14.4,-1,23.4,-7.4,-25.1,-2.3,0,7.1,-12.6,11.4,-9.7,12.7,0.7,-5.2,3.9,0,-24.8,12.2,8.3,-3.3,-5.2,7.2,-0.6,0.8,10,0,3.3,0,2.4,5.3,-9.1,0.4,-4.2,-3.8,0.9,-9.1,0,0,2.9,-0.6,0.2,0.5,-0.3,-1.2,-1.7,-2.9,-1.8,-2.3,0,-1.3,0.7,1,-1.4,0,0.6,-0.1,0.8,0.1,-1,0.1,0.2];
  const GD = [0,12,9.7,-11.6,-5.2,-8,-1.3,-4.2,0.4,-15.6,-1.6,-2.4,-6,5.6,-7,0.6,1.4,0,0.6,2.2,0.9,-0.2,-0.4,0.9,1.2,-0.9,0.3,0.9,0,-0.1,-0.1,0.5,-0.1,-0.8,-0.8,0.8,-0.1,0.2,0,0.5,-0.1,0.3,0.2,0,0.2,0,-0.1,0.1,0.3,-0.3,0,0.3,-0.1,0.1,-0.1,0.1,0,0.1,0.1,0,-0.3,0,-0.1,-0.1,0,0,0,0,0,0,0,-0.1,0,0,-0.1,-0.1,-0.1,-0.1,0,0,0,0,0,0,0.1,0,0,0,-0.1,0,-0.1];
  const HD = [0,0,-21.5,0,-27.7,-12.1,0,4,-0.3,-4.1,0,-1.1,4.1,1.6,-4.4,0,-0.5,2.2,0.4,1.7,1.9,0,0.3,-1.6,-0.4,0.9,0.7,0.9,0,0.6,0.5,-0.8,0,-1,0.6,-0.2,0,-0.2,0.5,-0.4,0.4,-0.5,-0.6,0.3,0.2,0,-0.3,0.3,-0.3,0.3,0.2,-0.1,-0.2,0.4,0.1,0,0,0,-0.2,0.1,-0.1,0.1,0,-0.1,0.2,0,0,0,0.1,0,0.1,0,0,0.1,0,0,0,0,0,0,0,-0.1,0.1,0,0,0,0,0,0,0,-0.1];

  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const A = 6378.137, F = 1 / 298.257223563, E2 = F * (2 - F), RE = 6371.2; // WGS84 ellipsoid and the model's reference radius (km)

  // Schmidt semi-normalised associated Legendre functions S[n][m] of x = sin(latitude), for n up to N_MAX.
  function legendre(x) {
    const c = Math.sqrt(Math.max(0, 1 - x * x)), S = [];
    for (let n = 0; n <= N_MAX; n++) S.push(new Array(n + 1).fill(0));
    S[0][0] = 1;
    for (let n = 1; n <= N_MAX; n++) {
      S[n][n] = n === 1 ? c : Math.sqrt((2 * n - 1) / (2 * n)) * c * S[n - 1][n - 1];
      for (let m = 0; m < n; m++) {
        const prev2 = m <= n - 2 ? S[n - 2][m] : 0;
        S[n][m] = ((2 * n - 1) * x * S[n - 1][m] - Math.sqrt((n - 1 + m) * (n - 1 - m)) * prev2) / Math.sqrt(n * n - m * m);
      }
    }
    return S;
  }

  // Magnetic field components (nT): X north, Y east, Z down, at a geodetic latitude/longitude (deg), height (km above the
  // ellipsoid) and decimal year.
  function field(lat, lon, heightKm, year) {
    const phi = lat * D2R, lam = lon * D2R, dt = year - EPOCH;
    // geodetic -> geocentric spherical
    const rc = A / Math.sqrt(1 - E2 * Math.sin(phi) ** 2);
    const p = (rc + heightKm) * Math.cos(phi), z = (rc * (1 - E2) + heightKm) * Math.sin(phi);
    const r = Math.hypot(p, z), phiP = Math.asin(z / r);
    const ratio = RE / r;

    const sums = (ph) => { // returns { x, y, z } before the rotation back to geodetic
      const S = legendre(Math.sin(ph));
      let rn = ratio * ratio, bz = 0, by = 0, dsum = 0;
      for (let n = 1; n <= N_MAX; n++) {
        rn *= ratio;
        for (let m = 0; m <= n; m++) {
          const i = n * (n + 1) / 2 + m, g = G[i] + dt * GD[i], h = H[i] + dt * HD[i];
          const cm = Math.cos(m * lam), sm = Math.sin(m * lam), t = g * cm + h * sm;
          bz -= (n + 1) * rn * t * S[n][m];
          by += rn * m * (g * sm - h * cm) * S[n][m];
          dsum += rn * t * S[n][m]; // the potential-like sum, differentiated below
        }
      }
      return { bz, by, dsum };
    };

    // The north component needs the derivative of the Legendre functions with respect to latitude. A small central
    // difference is plenty accurate here.
    const eps = 1e-6, up = sums(phiP + eps), dn = sums(phiP - eps), mid = sums(phiP);
    const bxP = -(up.dsum - dn.dsum) / (2 * eps);
    const byP = mid.by / Math.cos(phiP);
    const bzP = mid.bz;
    const dphi = phiP - phi;
    return { x: bxP * Math.cos(dphi) - bzP * Math.sin(dphi), y: byP, z: bxP * Math.sin(dphi) + bzP * Math.cos(dphi) };
  }

  function decimalYear(date) {
    const y = date.getUTCFullYear(), start = Date.UTC(y, 0, 1), end = Date.UTC(y + 1, 0, 1);
    return y + (date.getTime() - start) / (end - start);
  }

  // Declination in degrees (east positive). Returns 0 for anything that cannot be worked out, so a bad input never
  // makes the compass worse than it was.
  function declination(lat, lon, date = new Date(), heightKm = 0) {
    if (![lat, lon, heightKm].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lon) > 360) return 0;
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return 0;
    const lt = Math.max(-89.99, Math.min(89.99, lat)); // the model breaks down right at the poles
    const f = field(lt, lon, heightKm, decimalYear(d));
    const dec = Math.atan2(f.y, f.x) * R2D;
    return Number.isFinite(dec) ? dec : 0;
  }

  // A magnetic compass heading made true (0 = true north, clockwise).
  function trueHeading(magneticHeading, decl) {
    return (((magneticHeading + (Number.isFinite(decl) ? decl : 0)) % 360) + 360) % 360;
  }

  return { declination, trueHeading, EPOCH, VALID_FROM: 2025, VALID_UNTIL: 2030 };
});
