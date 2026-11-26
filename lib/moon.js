/* FarGems Moon: draws the Moon as it looks tonight (the lit part and the dark part, with the dark patches of the
 * seas), for the camera view. Browser: window.FarGemsMoon. Node: require('../lib/moon.js') for tests.
 *
 * Conventions: k is the lit fraction of the disc (0 new, 0.5 half, 1 full), as astronomy-engine gives it. The lit side
 * points toward the Sun, so draw() takes the screen angle of the Sun's direction (radians, canvas style: 0 = right,
 * y down). tilt turns the seas to match how the Moon is turned in the sky at that moment. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FarGemsMoon = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // The big dark seas as seen from the northern hemisphere with north up: [x, y, radius] as fractions of the radius
  // of the disc (x to the right, y down). Approximate: enough to look like the Moon, not a map.
  const MARIA = [
    [-0.28, -0.40, 0.26], // Imbrium
    [0.18, -0.38, 0.15],  // Serenitatis
    [0.34, -0.08, 0.17],  // Tranquillitatis
    [0.64, -0.22, 0.09],  // Crisium
    [0.50, 0.22, 0.10],   // Fecunditatis
    [-0.15, 0.36, 0.14],  // Nubium
    [-0.62, -0.05, 0.22], // Oceanus Procellarum
    [-0.52, 0.32, 0.08],  // Humorum
  ];

  const clamp01 = (k) => Math.max(0, Math.min(1, Number.isFinite(k) ? k : 0));

  // Where the edge between light and dark crosses the middle of the disc, as a fraction of the radius measured toward the
  // Sun: +1 is a new Moon (all the way at the lit rim), 0 is a half Moon, -1 is a full Moon (all the way round the far side).
  function terminator(k) { return 1 - 2 * clamp01(k); }

  // Outline of the lit part with the Sun toward +x, centred on 0, 0.
  function litPath(ctx, r, k) {
    const tx = terminator(k) * r;
    ctx.beginPath();
    ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false); // the rim that faces the Sun, top to bottom
    if (tx >= 0) ctx.ellipse(0, 0, Math.max(tx, 0.001), r, 0, Math.PI / 2, -Math.PI / 2, true); // a crescent: the edge bows toward the Sun
    else ctx.ellipse(0, 0, -tx, r, 0, Math.PI / 2, Math.PI * 1.5, false); // gibbous: the edge bows away from the Sun
    ctx.closePath();
  }

  // Draw the Moon at x, y with radius r.
  function draw(ctx, x, y, r, k, sunAngle, tilt) {
    ctx.save();
    ctx.translate(x, y);
    // The part in shadow, faintly lit by the Earth.
    ctx.fillStyle = 'rgba(64, 74, 96, 0.6)';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    // The lit part, with the seas drawn on it.
    ctx.save();
    ctx.rotate(Number.isFinite(sunAngle) ? sunAngle : 0);
    litPath(ctx, r, k);
    ctx.fillStyle = '#f3efe2'; ctx.fill();
    ctx.clip();
    ctx.rotate(-(Number.isFinite(sunAngle) ? sunAngle : 0) + (Number.isFinite(tilt) ? tilt : 0)); // the seas follow the sky, not the Sun
    ctx.fillStyle = 'rgba(96, 102, 118, 0.38)';
    for (const [mx, my, mr] of MARIA) { ctx.beginPath(); ctx.arc(mx * r, my * r, mr * r, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'; // the bright rays of Tycho
    ctx.beginPath(); ctx.arc(-0.1 * r, 0.78 * r, 0.05 * r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  return { MARIA, terminator, litPath, draw };
});
