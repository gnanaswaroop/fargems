/* FarGems AR maths: where in the camera picture a sky object appears, from the phone's orientation.
 * Pure functions, no DOM. Browser: window.FarGemsAR. Node: require('../lib/ar.js') for tests.
 *
 * Conventions: azimuth is degrees clockwise from north, elevation is degrees above the horizon.
 * Screen pixels have y pointing down. Phone roll is ignored: the picture assumes the phone is held upright. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FarGemsAR = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const norm360 = (a) => ((a % 360) + 360) % 360;

  // Where the back camera points, from the W3C device orientation angles (degrees).
  // heading: 0 = north, clockwise. pitch: 0 = level, +90 = straight up, -90 = straight down.
  // alpha only matters for heading, and only when it is measured against north.
  function cameraPose(alpha, beta, gamma) {
    const a = (alpha || 0) * D2R, b = (beta || 0) * D2R, g = (gamma || 0) * D2R;
    const sA = Math.sin(a), cA = Math.cos(a), sB = Math.sin(b), cB = Math.cos(b), sG = Math.sin(g), cG = Math.cos(g);
    // The device z axis in earth coordinates (x east, y north, z up). The back camera looks along its negative.
    const m13 = cA * sG + sA * sB * cG;
    const m23 = sA * sG - cA * sB * cG;
    const m33 = cB * cG;
    return {
      heading: norm360(Math.atan2(-m13, -m23) * R2D),
      pitch: Math.asin(Math.max(-1, Math.min(1, -m33))) * R2D,
    };
  }

  // Unit vector (east, north, up) for a direction.
  function toVec(az, el) {
    const a = az * D2R, e = el * D2R;
    return [Math.cos(e) * Math.sin(a), Math.cos(e) * Math.cos(a), Math.sin(e)];
  }

  // Project a sky direction into the camera picture.
  // pose: { heading, pitch }. view: { W, H, vfov } in pixels and degrees (vertical field of view).
  // Returns { x, y, front, onScreen, xc, yc }: xc and yc are the target's right and up offsets in the camera
  // frame, used to point an arrow at it when it is off screen. front is false when it is behind the camera.
  function projectToScreen(target, pose, view) {
    const t = toVec(target.az, target.el);
    const h = pose.heading * D2R, p = pose.pitch * D2R;
    const f = [Math.cos(p) * Math.sin(h), Math.cos(p) * Math.cos(h), Math.sin(p)];
    const r = [Math.cos(h), -Math.sin(h), 0];
    const u = [-Math.sin(p) * Math.sin(h), -Math.sin(p) * Math.cos(h), Math.cos(p)];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const xc = dot(t, r), yc = dot(t, u), zc = dot(t, f);
    const focal = (view.H / 2) / Math.tan((view.vfov * D2R) / 2);
    const front = zc > 1e-6;
    const x = front ? view.W / 2 + (xc / zc) * focal : NaN;
    const y = front ? view.H / 2 - (yc / zc) * focal : NaN;
    const onScreen = front && x >= 0 && x <= view.W && y >= 0 && y <= view.H;
    return { x, y, front, onScreen, xc, yc };
  }

  // Horizontal field of view for a vertical one on a screen of the given shape.
  function hfovFor(vfov, W, H) {
    return 2 * Math.atan(Math.tan((vfov * D2R) / 2) * W / H) * R2D;
  }

  // A point on the screen edge, and the arrow angle (radians, 0 = right, y down), that points toward an
  // off-screen target. Used with projectToScreen's xc and yc, so it also works for targets behind the camera.
  function edgeIndicator(xc, yc, W, H, margin = 28) {
    const dx = xc, dy = -yc; // screen y points down
    const len = Math.hypot(dx, dy) || 1e-9;
    const ux = dx / len, uy = dy / len;
    const hw = W / 2 - margin, hh = H / 2 - margin;
    const k = Math.min(Math.abs(ux) > 1e-9 ? hw / Math.abs(ux) : Infinity, Math.abs(uy) > 1e-9 ? hh / Math.abs(uy) : Infinity);
    return { x: W / 2 + ux * k, y: H / 2 + uy * k, angle: Math.atan2(uy, ux) };
  }

  // Camera mode with some hysteresis, so the view does not flicker near the threshold.
  // Phone raised nearly upright to point at the sky: pitch above -15. Holding it tilted to read or laid flat
  // (pitch -30 and lower) never opens it, and it closes again once it drops below -40.
  const ENTER_PITCH = -15, EXIT_PITCH = -40;
  function wantsAR(current, pitch) {
    if (!Number.isFinite(pitch)) return current;
    if (current) return pitch > EXIT_PITCH;
    return pitch > ENTER_PITCH;
  }

  // Automatic open/close of the camera view. The phone must be held steadily for HOLD_MS before anything happens.
  // A camera failure or a manual close calls suppress(), which blocks automatic opening until the phone has been
  // laid flat once, so a broken camera cannot be retried over and over.
  const HOLD_MS = 700;
  function newAutoState() { return { want: false, since: 0, suppressed: false }; }
  function suppress(st) { return { ...st, suppressed: true }; }
  // inp: { pitch, now, isOpen, opening, cameraGranted, compassOn, onRadarPage }. Returns { state, action }
  // where action is 'open', 'close' or null.
  function autoStep(st, inp) {
    const want = wantsAR(st.want, inp.pitch);
    const next = { ...st };
    if (want !== st.want) { next.want = want; next.since = inp.now; }
    if (inp.now - next.since < HOLD_MS) return { state: next, action: null };
    if (!want) { next.suppressed = false; return { state: next, action: inp.isOpen ? 'close' : null }; }
    const ok = inp.cameraGranted && inp.compassOn && !next.suppressed && !inp.isOpen && !inp.opening && inp.onRadarPage;
    return { state: next, action: ok ? 'open' : null };
  }

  // The nearest tappable item to a point, or null. Items are { id, x, y, r }, r being the tap radius.
  function pickNearest(items, x, y) {
    let best = null, bd = Infinity;
    for (const it of items) {
      const d = Math.hypot(it.x - x, it.y - y);
      if (d <= it.r && d < bd) { best = it; bd = d; }
    }
    return best;
  }

  // Heading to use: the compass reading when the browser gives one (iPhone), otherwise the angle-based one.
  function chooseHeading(compassHeading, poseHeading) {
    return typeof compassHeading === 'number' && Number.isFinite(compassHeading) ? norm360(compassHeading) : poseHeading;
  }

  // Smooth a heading toward a new reading by factor k, taking the short way round the circle.
  function smoothHeading(prev, next, k = 0.25) {
    if (prev == null) return next;
    const d = norm360(next - prev + 180) - 180;
    return norm360(prev + d * k);
  }

  return { ENTER_PITCH, EXIT_PITCH, cameraPose, toVec, projectToScreen, hfovFor, edgeIndicator, wantsAR, HOLD_MS, newAutoState, suppress, autoStep, pickNearest, chooseHeading, smoothHeading };
});
