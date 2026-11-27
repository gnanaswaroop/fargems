/* FarGems card previews: the small picture at the top of an object's detail card.
 * Pure functions, no DOM. Browser: window.FarGemsPreview. Node: require('../lib/preview.js') for tests.
 *
 *   bodyArt(o)       a drawing of the Sun, the Moon (as lit tonight) or a planet, as SVG text. Made here, so it is instant,
 *                    works offline and asks nobody for anything.
 *   photoOf(json)    the picture to show for an aircraft type or a space station, taken from its Wikipedia summary: the https
 *                    address of a thumbnail, or null when the article has none.
 *   photoKind(o)     whether an object gets a photo from Wikipedia (flights and satellites) or a drawing (the Sun, Moon, planets).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FarGemsPreview = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const R = 40; // radius of the disc in the drawing; the picture is 100 x 100 with the disc in the middle
  const clamp01 = (k) => Math.max(0, Math.min(1, Number.isFinite(k) ? k : 0));
  const hex = (c, d) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : d);
  const f2 = (n) => Math.round(n * 100) / 100;
  const svg = (inner, label) => `<svg viewBox="0 0 100 100" role="img" aria-label="${label}" focusable="false">${inner}</svg>`;

  // The Moon: the dark disc with the lit part on top. k is the lit fraction (0 new, 1 full). The lit side is on the right when
  // the Moon is waxing, seen from the northern hemisphere; waning, or seen from the south, it is on the left.
  function moonArt(k, waxing, south) {
    k = clamp01(k);
    const right = !!waxing !== !!south, rx = f2(Math.abs(1 - 2 * k) * R);
    const lit = k <= 0.005 ? '' : k >= 0.995 ? `<circle r="${R}" fill="url(#pvMoon)"/>`
      : `<path d="M0 ${-R} A${R} ${R} 0 0 1 0 ${R} A${rx} ${R} 0 0 ${k > 0.5 ? 1 : 0} 0 ${-R} Z" fill="url(#pvMoon)"/>`;
    const seas = '<g fill="#8f98a8" opacity=".35"><circle cx="-12" cy="-15" r="10"/><circle cx="8" cy="-16" r="6"/><circle cx="15" cy="-3" r="7"/><circle cx="-24" cy="-2" r="8"/><circle cx="-6" cy="14" r="5"/></g>';
    const pct = Math.round(k * 100);
    return svg(`<defs><radialGradient id="pvMoon" cx=".4" cy=".4" r=".8"><stop offset="0" stop-color="#f3f1e8"/><stop offset="1" stop-color="#c9ccd2"/></radialGradient>`
      + `<clipPath id="pvMoonDisc"><circle r="${R}"/></clipPath></defs>`
      + `<g transform="translate(50 50)"><circle r="${R}" fill="#232a38"/>`
      + `<g transform="scale(${right ? 1 : -1} 1)">${lit}</g><g clip-path="url(#pvMoonDisc)">${seas}</g></g>`, `The Moon tonight, ${pct}% lit`);
  }

  // A shaded ball in the colour of the planet, with the bands of Jupiter and the rings of Saturn.
  function planetArt(name, color) {
    const c = hex(color, '#cfd6e4'), id = 'pvP' + String(name).replace(/\W/g, '');
    const ball = `<defs><radialGradient id="${id}" cx=".36" cy=".34" r=".85"><stop offset="0" stop-color="${c}"/><stop offset=".6" stop-color="${c}" stop-opacity=".9"/><stop offset="1" stop-color="#05070c"/></radialGradient>`
      + `<clipPath id="${id}c"><circle r="${R}"/></clipPath></defs>`;
    const bands = name === 'Jupiter' ? '<g clip-path="url(#' + id + 'c)" fill="#8a5a3a" opacity=".4"><rect x="-40" y="-22" width="80" height="7"/><rect x="-40" y="-6" width="80" height="9"/><rect x="-40" y="12" width="80" height="6"/></g>' : '';
    const cap = name === 'Mars' ? '<ellipse cy="-36" rx="11" ry="4" fill="#f4f1ea" opacity=".85" clip-path="url(#' + id + 'c)"/>' : '';
    if (name === 'Saturn') {
      const g = `<g transform="translate(50 50) rotate(-18)">`;
      return svg(ball + g + `<path d="M-46 0 A46 12 0 0 1 46 0" fill="none" stroke="#b9a77d" stroke-width="5" opacity=".9"/>`
        + `<g transform="scale(.8)"><circle r="${R}" fill="url(#${id})"/></g>`
        + `<path d="M-46 0 A46 12 0 0 0 46 0" fill="none" stroke="#d8c79a" stroke-width="5"/></g>`, 'Saturn with its rings');
    }
    return svg(ball + `<g transform="translate(50 50)"><circle r="${R}" fill="url(#${id})"/>${bands}${cap}</g>`, esc(name));
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  function sunArt() {
    const rays = Array.from({ length: 12 }, (_, i) => `<rect x="-1.6" y="-47" width="3.2" height="9" rx="1.6" transform="rotate(${i * 30})"/>`).join('');
    return svg('<defs><radialGradient id="pvSun" cx=".4" cy=".4" r=".8"><stop offset="0" stop-color="#fff3b0"/><stop offset="1" stop-color="#ffb739"/></radialGradient></defs>'
      + `<g transform="translate(50 50)"><g fill="#ffd36b" opacity=".85">${rays}</g><circle r="30" fill="url(#pvSun)"/></g>`, 'The Sun');
  }

  // The drawing for a body of the sky list, or null for anything else. opts: { waxing, south, uid }. The same card is in the page
  // twice (under the radar and over the camera), so uid keeps the names inside each drawing apart.
  function bodyArt(o, opts) {
    if (!o || o.kind !== 'body') return null;
    const s = o.name === 'Sun' ? sunArt() : o.name === 'Moon' ? moonArt(o.phase, !opts || opts.waxing !== false, !!(opts && opts.south)) : planetArt(o.name, o.color);
    const uid = String((opts && opts.uid) || '').replace(/\W/g, '');
    return uid ? s.replace(/\bpv[A-Za-z]+/g, (m) => m + uid) : s;
  }

  // Which sort of picture an object gets: 'art' (drawn here), 'photo' (from its Wikipedia article) or null.
  function photoKind(o) {
    if (!o) return null;
    if (o.kind === 'body') return 'art';
    return o.kind === 'air' || o.kind === 'sat' ? 'photo' : null;
  }

  // The thumbnail of a Wikipedia summary (the REST page/summary answer): an https address on Wikimedia (thumb. or upload.), or null.
  function photoOf(json) {
    const t = json && json.thumbnail;
    const src = t && typeof t.source === 'string' ? t.source : '';
    return /^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(src) ? src : null;
  }

  return { bodyArt, moonArt, planetArt, sunArt, photoKind, photoOf };
});
