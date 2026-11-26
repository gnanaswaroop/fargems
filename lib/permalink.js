/* FarGems object permalinks: one address for one object in the sky, the same as picking it on the radar.
 * Pure functions, no DOM. Browser: window.FarGemsLink. Node: require('../lib/permalink.js') for tests.
 *
 *   viewer.html#o=sat:25544        the ISS (a satellite by its NORAD number)
 *   viewer.html#o=air:4ca7b2       a flight by its transponder address
 *   viewer.html#o=body:Mars        the Sun, Moon and planets
 *   viewer.html#o=star:Alpha%20Centauri
 *   viewer.html#o=met:Perseids     a meteor shower radiant
 *
 * The link names the object only. It never carries a place: whoever opens it sees the object from where they are. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FarGemsLink = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // The same ids the sky uses: a kind, a colon, and the object's own key. Letters, digits, spaces and a few marks only.
  const ID = /^(air|sat|body|star|met):([A-Za-z0-9~][A-Za-z0-9~ .'\-]{0,39})$/;

  function validId(id) { return typeof id === 'string' && ID.test(id); }

  // "viewer.html#o=sat:25544" with the page address in front for an object id; null when the id is not one a link can carry.
  // The colon stays readable; spaces and the like are escaped.
  function objectLink(base, id) {
    if (!validId(id)) return null;
    const i = id.indexOf(':');
    return String(base).replace(/#.*$/, '') + '#o=' + id.slice(0, i + 1) + encodeURIComponent(id.slice(i + 1));
  }

  // The object id in an address hash ("#o=sat:25544"), or null when there is none or it is not a proper id.
  function parseLink(hash) {
    const m = /(?:^#?|&)o=([^&]*)/.exec(String(hash == null ? '' : hash));
    if (!m) return null;
    let id;
    try { id = decodeURIComponent(m[1]); } catch { return null; }
    return validId(id) ? id : null;
  }

  // What to say about an object that is not on the radar. `info` is what the page knows:
  //   unseen: { why: 'below' | 'far', name, el, az, rangeKm }  the sky had it, but it is not to be seen from here
  //   ready:  { loc, aircraft, sats }                          what has been loaded so far (so "not found" is not said too early)
  // Returns { kind: 'wait' | 'below' | 'far' | 'gone' | 'inactive', name, title, text }.
  function missing(id, info) {
    const kind = id.slice(0, id.indexOf(':')), key = id.slice(id.indexOf(':') + 1);
    const u = (info && info.unseen) || null, ready = (info && info.ready) || {};
    const name = (u && u.name) || (kind === 'sat' ? 'Satellite ' + key : kind === 'air' ? 'Flight ' + key.toUpperCase() : key);
    const wait = (text) => ({ kind: 'wait', name, title: 'Looking for ' + name, text });
    if (!ready.loc) return wait('Waiting for your location, to see where it is from there.');
    if (u && u.why === 'below') {
      const down = Math.max(1, Math.round(-u.el));
      return { kind: 'below', name, title: name + ' is below the horizon', text: 'It is ' + down + '° below the horizon, toward the ' + (info.dir || '') + ', so it cannot be seen from here right now.' };
    }
    if (u && u.why === 'far') {
      return { kind: 'far', name, title: name + ' is too far to see', text: 'It is about ' + (info.rangeText || Math.round(u.rangeKm) + ' km') + ' away and low in the sky, too far to see with the eye from here.' };
    }
    if (kind === 'air') {
      if (!ready.aircraft) return wait('Checking the flights around you.');
      return { kind: 'gone', name, title: name + ' is not in your sky', text: 'This flight is not among the flights around you right now. It may have landed, or it is flying out of range of where you are.' };
    }
    if (kind === 'sat') {
      if (!ready.sats) return wait('Loading the satellites.');
      return { kind: 'gone', name, title: name + ' is not in your sky', text: 'FarGems does not have this satellite, or it is not above your horizon right now.' };
    }
    if (kind === 'met') return { kind: 'inactive', name, title: name + ' is not active now', text: 'This meteor shower is not on right now, so it has no radiant to point at.' };
    return { kind: 'gone', name, title: name + ' is not in the sky list', text: 'FarGems does not know this object.' };
  }

  return { validId, objectLink, parseLink, missing };
});
