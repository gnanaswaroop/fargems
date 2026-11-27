/* FarGems body art: how the Sun, Moon and planets are drawn as small marks on the radar. Browser: window.FarGemsBodyArt.
 * Node: require('../lib/bodyart.js') for tests.
 *
 * Kept simple on purpose: a plain disc for each body, with one quiet cue where it helps to tell them apart. The Moon shows
 * only the phase it is in tonight, and Saturn has its rings. Jupiter has two faint bands. Everything else is a plain disc
 * (tap one for the details). */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./moon.js') : root.FarGemsMoon);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FarGemsBodyArt = api;
})(typeof self !== 'undefined' ? self : globalThis, function (Moon) {
  'use strict';

  const RING_TILT = -0.35;           // the rings lean a little, as they usually look, in radians
  const RING_W = 2.1, RING_H = 0.6;  // the ring ellipse as a multiple of the disc radius

  // How far from the middle the mark reaches, so a name can be put clear of it.
  function extent(name, r) { return name === 'Saturn' ? r * RING_W : r; }

  // Radius of a planet's disc from its brightness: brighter is bigger, within a small range. Saturn gets a little more
  // room so that its rings can be seen.
  function planetRadius(name, mag) {
    const r = Math.max(2.5, 5.5 - (Number.isFinite(mag) ? mag : 0) * 0.8);
    return name === 'Saturn' ? Math.max(3.5, r) : r;
  }

  function disc(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); }

  // The Moon: the dark disc, with the lit part toward the Sun. k is the lit fraction (0 new, 1 full); sunAngle is the screen
  // direction of the Sun from the Moon (radians, 0 = right, y down).
  function drawMoon(ctx, x, y, r, k, sunAngle, outline) {
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = 'rgba(58, 68, 94, 0.9)'; disc(ctx, 0, 0, r); ctx.fill();
    if (Number.isFinite(k) && k > 0.01) {
      ctx.save(); ctx.rotate(Number.isFinite(sunAngle) ? sunAngle : 0);
      Moon.litPath(ctx, r, k); ctx.fillStyle = '#f3efe2'; ctx.fill(); ctx.restore();
    }
    if (outline) { ctx.strokeStyle = outline; ctx.lineWidth = 1; disc(ctx, 0, 0, r); ctx.stroke(); }
    ctx.restore();
  }

  function drawSaturn(ctx, x, y, r, color, outline) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(RING_TILT);
    const ring = (from, to) => { ctx.beginPath(); ctx.ellipse(0, 0, r * RING_W, r * RING_H, 0, from, to); ctx.stroke(); };
    ctx.lineWidth = Math.max(1, r * 0.28); ctx.strokeStyle = 'rgba(232, 208, 138, 0.8)';
    ring(Math.PI, Math.PI * 2); // the far half, behind the planet
    ctx.fillStyle = color; disc(ctx, 0, 0, r); ctx.fill();
    if (outline) { ctx.strokeStyle = outline; ctx.lineWidth = 1; disc(ctx, 0, 0, r); ctx.stroke(); }
    ctx.lineWidth = Math.max(1, r * 0.28); ctx.strokeStyle = 'rgba(232, 208, 138, 0.95)';
    ring(0, Math.PI); // the near half, in front
    ctx.restore();
  }

  function drawJupiter(ctx, x, y, r, color, outline) {
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = color; disc(ctx, 0, 0, r); ctx.fill();
    ctx.save(); disc(ctx, 0, 0, r); ctx.clip();
    ctx.strokeStyle = 'rgba(150, 105, 70, 0.4)'; ctx.lineWidth = Math.max(0.8, r * 0.18);
    for (const dy of [-0.32, 0.28]) { ctx.beginPath(); ctx.moveTo(-r, dy * r); ctx.lineTo(r, dy * r); ctx.stroke(); }
    ctx.restore();
    if (outline) { ctx.strokeStyle = outline; ctx.lineWidth = 1; disc(ctx, 0, 0, r); ctx.stroke(); }
    ctx.restore();
  }

  // Draw body o (kind 'body') at x, y. r is the radius of its disc. Returns nothing; the glow is set here.
  function draw(ctx, o, x, y, r, sunAngle, outline) {
    const big = o.name === 'Sun' || o.name === 'Moon';
    ctx.save();
    ctx.shadowColor = o.color; ctx.shadowBlur = big ? 14 : o.name === 'Venus' ? 9 : 6;
    if (o.name === 'Moon') drawMoon(ctx, x, y, r, o.phase, sunAngle, outline);
    else if (o.name === 'Saturn') drawSaturn(ctx, x, y, r, o.color, outline);
    else if (o.name === 'Jupiter') drawJupiter(ctx, x, y, r, o.color, outline);
    else { ctx.fillStyle = o.color; disc(ctx, x, y, r); ctx.fill(); if (outline) { ctx.shadowBlur = 0; ctx.strokeStyle = outline; ctx.lineWidth = 1; ctx.stroke(); } }
    ctx.restore();
  }

  return { RING_TILT, RING_W, RING_H, extent, planetRadius, draw, drawMoon, drawSaturn, drawJupiter };
});
