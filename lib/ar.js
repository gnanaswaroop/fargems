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

  // The way the phone is facing, in degrees from north, whatever the tilt: with the phone flat it is where the top points,
  // with the phone raised to look at the sky it is where the back camera points, and in between a blend of the two. Both
  // point the same way on the ground, so the radar and the camera view agree and the reading does not jump when the phone
  // goes up or comes down. (Using only the top of the phone, as before, is meaningless once the phone is upright.)
  // Returns null when there is no usable direction (phone nearly vertical and rolled over).
  // screenAngle is how far the screen is turned from the device's natural position (screen.orientation.angle: 0, 90, 180
  // or 270). The sensor angles belong to the device, not to the screen, so on a tablet (whose natural position is
  // sideways) or a phone that is turned sideways, the top of the screen is not the device's own top. The top of the
  // screen is the device's y axis turned by that angle.
  function facingHeading(alpha, beta, gamma, screenAngle) {
    const a = (alpha || 0) * D2R, b = (beta || 0) * D2R, g = (gamma || 0) * D2R, th = (Number(screenAngle) || 0) * D2R;
    const sA = Math.sin(a), cA = Math.cos(a), sB = Math.sin(b), cB = Math.cos(b), sG = Math.sin(g), cG = Math.cos(g);
    // The device x axis, y axis (its top) and z axis, in earth coordinates (east, north, up).
    const xE = cA * cG - sA * sB * sG, xN = sA * cG + cA * sB * sG, xUp = -cB * sG;
    const yE = -sA * cB, yN = cA * cB, yUp = sB;
    const zE = cA * sG + sA * sB * cG, zN = sA * sG - cA * sB * cG, zUp = cB * cG;
    // The top of the screen.
    const topE = Math.sin(th) * xE + Math.cos(th) * yE, topN = Math.sin(th) * xN + Math.cos(th) * yN, topUp = Math.sin(th) * xUp + Math.cos(th) * yUp;
    const t = Math.max(0, topUp), w = t * t; // 0 flat, 1 upright: how much the back camera counts
    // Leaning back past upright the screen faces down and its top points toward the viewer, so only the camera counts then.
    const top = zUp > 0 ? 1 : 0;
    const e = top * topE - w * zE, n = top * topN - w * zN;
    if (Math.hypot(e, n) < 0.05) return null;
    return norm360(Math.atan2(e, n) * R2D);
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

  // The compass points drawn around the horizon in the camera view: the eight directions, and magnetic north when it is
  // more than half a degree away from true north (the sky is laid out from true north, a phone compass reads magnetic).
  // declination is the angle from magnetic north to true north, east positive, so magnetic north lies at -declination.
  const POINT_NAMES = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  function compassPoints(declination) {
    const pts = POINT_NAMES.map((name, i) => ({ name, az: i * 45, major: i % 2 === 0, north: i === 0, mag: false }));
    const d = Number(declination);
    if (Number.isFinite(d) && Math.abs(d) >= 0.5) pts.push({ name: 'Mag N', az: ((-d % 360) + 360) % 360, major: true, north: false, mag: true });
    return pts;
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
  // inp: { pitch, now, isOpen, opening, cameraGranted, compassOn, onRadarPage, closeAllowed }. Returns { state, action }
  // where action is 'open', 'close' or null.
  function autoStep(st, inp) {
    const want = wantsAR(st.want, inp.pitch);
    const next = { ...st };
    if (want !== st.want) { next.want = want; next.since = inp.now; }
    if (inp.now - next.since < HOLD_MS) return { state: next, action: null };
    // Laying the phone flat closes a view that opened by itself. A view the visitor opened with the AR button stays until
    // they close it (closeAllowed false), otherwise tapping AR with the phone held low would close it again at once.
    if (!want) { next.suppressed = false; return { state: next, action: inp.isOpen && inp.closeAllowed !== false ? 'close' : null }; }
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

  // Aiming: the object under the crosshair (the middle of the picture) is picked on its own once the phone has been held on it
  // for a moment, so a tap is not needed. The object nearest the middle within AIM_RADIUS pixels is the target; it must stay the
  // target for AIM_DWELL_MS before it is chosen, so a phone swinging past things picks nothing. Once chosen it is not chosen
  // again until the crosshair has left it (or gone to another object), so a tap on something else is not undone while aiming.
  const AIM_RADIUS = 28, AIM_DWELL_MS = 600;
  function aimTarget(items, W, H, radius = AIM_RADIUS) {
    let best = null, bd = Infinity;
    for (const it of items || []) {
      if (!it || !Number.isFinite(it.x) || !Number.isFinite(it.y)) continue;
      const d = Math.hypot(it.x - W / 2, it.y - H / 2);
      if (d <= radius && d < bd) { best = it; bd = d; }
    }
    return best ? best.id : null;
  }
  // One step of the aim timer. st: { id, since, done }; returns { st, select, progress } where select is the id to pick now (or
  // null) and progress is 0 to 1 of the hold so far (to draw it).
  function aimStep(st, targetId, now, selectedId, dwell = AIM_DWELL_MS) {
    if (targetId == null) return { st: { id: null, since: 0, done: false }, select: null, progress: 0 };
    let s = st && st.id === targetId ? st : { id: targetId, since: now, done: false };
    if (targetId === selectedId) s = { ...s, done: true }; // already the pick: nothing to do until the crosshair leaves it
    if (s.done) return { st: s, select: null, progress: 1 };
    if (now - s.since >= dwell) return { st: { ...s, done: true }, select: targetId, progress: 1 };
    return { st: s, select: null, progress: Math.max(0, (now - s.since) / dwell) };
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

  // How much of the way to a new reading to move. Small differences are sensor noise, so they are smoothed; a big difference
  // is the phone really having turned (the screen was rotated, the phone was swung round), and following it slowly just
  // looks like a lag. So the further away the new reading is, the faster the heading catches up.
  function smoothFactor(diffDeg) {
    const d = Math.abs(diffDeg);
    if (d >= 60) return 1;
    if (d >= 25) return 0.7;
    if (d >= 8) return 0.4;
    return 0.25;
  }
  // Move a heading toward a new reading the short way round, by the factor above (or all the way when snap is true).
  function followHeading(prev, next, snap) {
    if (prev == null || snap) return norm360(next);
    const d = norm360(next - prev + 180) - 180;
    return norm360(prev + d * smoothFactor(d));
  }

  // The direction, in the camera picture, from one sky object toward another (radians, canvas style: 0 = right, y down).
  // Used to point the lit side of the Moon at the Sun.
  function directionOnScreen(from, to, pose) {
    const m = toVec(from.az, from.el), t = toVec(to.az, to.el);
    const d = m[0] * t[0] + m[1] * t[1] + m[2] * t[2];
    const v = [t[0] - d * m[0], t[1] - d * m[1], t[2] - d * m[2]]; // toward the other object, along the sky at the first
    const h = pose.heading * D2R, p = pose.pitch * D2R;
    const r = [Math.cos(h), -Math.sin(h), 0];
    const u = [-Math.sin(p) * Math.sin(h), -Math.sin(p) * Math.cos(h), Math.cos(p)];
    const dx = v[0] * r[0] + v[1] * r[1] + v[2] * r[2], dy = v[0] * u[0] + v[1] * u[1] + v[2] * u[2];
    return Math.atan2(-dy, dx);
  }

  // The angle (degrees) between "up" in the sky and the direction of the celestial north pole at an object, seen from a
  // latitude. Zero on the meridian, positive in the east and negative in the west. It turns the Moon's face.
  function parallacticAngle(az, el, latDeg) {
    const A = az * D2R, h = el * D2R, phi = latDeg * D2R;
    return Math.atan2(Math.sin(A) * Math.cos(phi), Math.sin(phi) * Math.cos(h) - Math.cos(phi) * Math.sin(h) * Math.cos(A)) * R2D;
  }

  // The part of a video picture that a screen of W by H shows when the video fills it (object-fit: cover).
  function coverCrop(vw, vh, W, H) {
    const k = Math.max(W / vw, H / vh), sw = W / k, sh = H / k;
    return { sx: (vw - sw) / 2, sy: (vh - sh) / 2, sw, sh };
  }

  // A hand adjustment of the picture: degrees added to the heading and to the pitch, for a compass that reads a few
  // degrees off. Kept within a sensible range, and anything that is not numbers means no adjustment.
  const MAX_OFFSET_H = 45, MAX_OFFSET_P = 25;
  function clampOffset(off) {
    const h = Number(off && off.h), p = Number(off && off.p);
    return {
      h: Number.isFinite(h) ? Math.max(-MAX_OFFSET_H, Math.min(MAX_OFFSET_H, h)) : 0,
      p: Number.isFinite(p) ? Math.max(-MAX_OFFSET_P, Math.min(MAX_OFFSET_P, p)) : 0,
    };
  }
  function parseOffset(raw) {
    try { return clampOffset(JSON.parse(raw)); } catch { return { h: 0, p: 0 }; }
  }
  // Dragging the picture by dx, dy pixels moves the overlay with the finger. focal is in pixels.
  function dragOffset(off, dx, dy, focal) {
    if (!(focal > 0)) return clampOffset(off);
    return clampOffset({ h: (off ? off.h : 0) - (dx / focal) * R2D, p: (off ? off.p : 0) + (dy / focal) * R2D });
  }
  // The callout beside the picked object. The object's own icon is shown at first (so it is clear what was picked), then fades away so
  // it does not cover the real object, and a dotted ring marks the spot. The bubble with the details comes in soon after the pick.
  const CALLOUT_SHOW_MS = 400, CALLOUT_FADE_IN_MS = 300, ICON_HOLD_MS = 1500, ICON_FADE_MS = 400, RING_R = 24;
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  // ms: time since the object was picked. Returns the opacity (0 to 1) of the bubble and of the object's icon.
  function calloutPhase(ms) {
    const t = Number.isFinite(ms) ? ms : 0;
    return { bubble: clamp01((t - CALLOUT_SHOW_MS) / CALLOUT_FADE_IN_MS), icon: 1 - clamp01((t - ICON_HOLD_MS) / ICON_FADE_MS) };
  }
  // Where a bubble w by h goes for an object drawn at (x, y): beside it, above first (the controls are at the bottom), to the right
  // first. bounds is { left, top, right, bottom }, the room it may use. The first of the four corners that fits wholly inside the
  // bounds, and clear of the other objects in avoid ([{ x, y, r }], so a bubble does not hide a neighbour), wins; when none does the
  // one that overflows or covers least is used and pushed inside. Returns { x, y, w, h, side }.
  function placeCallout(x, y, w, h, bounds, gap = 46, avoid = []) {
    const cands = [
      { side: 'up-right', x: x + gap * 0.6, y: y - gap - h },
      { side: 'up-left', x: x - gap * 0.6 - w, y: y - gap - h },
      { side: 'down-right', x: x + gap * 0.6, y: y + gap },
      { side: 'down-left', x: x - gap * 0.6 - w, y: y + gap },
    ];
    const covers = (c) => (avoid || []).filter((q) => q && Number.isFinite(q.x) && Number.isFinite(q.y)
      && Math.hypot(Math.max(c.x, Math.min(q.x, c.x + w)) - q.x, Math.max(c.y, Math.min(q.y, c.y + h)) - q.y) < (q.r || 24)).length;
    const over = (c) => Math.max(0, bounds.left - c.x) + Math.max(0, c.x + w - bounds.right) + Math.max(0, bounds.top - c.y) + Math.max(0, c.y + h - bounds.bottom) + 60 * covers(c);
    let best = cands[0], bo = Infinity;
    for (const c of cands) { const o = over(c); if (o === 0) { best = c; bo = 0; break; } if (o < bo) { best = c; bo = o; } }
    const px = Math.max(bounds.left, Math.min(best.x, bounds.right - w)), py = Math.max(bounds.top, Math.min(best.y, bounds.bottom - h));
    return { x: px, y: py, w, h, side: best.side };
  }
  // The dotted line from the ring around the object to the nearest point of the bubble. Returns null when the bubble is on the ring.
  function calloutLeader(x, y, box, ringR = RING_R) {
    const tx = Math.max(box.x, Math.min(x, box.x + box.w)), ty = Math.max(box.y, Math.min(y, box.y + box.h));
    const dx = tx - x, dy = ty - y, d = Math.hypot(dx, dy);
    if (d <= ringR + 2) return null;
    return { x1: x + (dx / d) * ringR, y1: y + (dy / d) * ringR, x2: tx, y2: ty };
  }

  function focalFor(H, vfov) { return (H / 2) / Math.tan((vfov * D2R) / 2); }

  return { directionOnScreen, parallacticAngle, coverCrop, clampOffset, parseOffset, dragOffset, focalFor, ENTER_PITCH, EXIT_PITCH, cameraPose, facingHeading, toVec, projectToScreen, hfovFor, edgeIndicator, compassPoints, wantsAR, HOLD_MS, newAutoState, suppress, autoStep, pickNearest, CALLOUT_SHOW_MS, ICON_HOLD_MS, ICON_FADE_MS, RING_R, calloutPhase, placeCallout, calloutLeader, AIM_RADIUS, AIM_DWELL_MS, aimTarget, aimStep, chooseHeading, smoothHeading, smoothFactor, followHeading };
});
