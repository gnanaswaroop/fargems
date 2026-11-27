/* FarGems sky search: find an object by what it is called, so it can be picked without looking for it on the radar.
 * Pure functions, no DOM. Browser: window.FarGemsSearch. Node: require('../lib/search.js') for tests.
 *
 *   search(query, { objs, unseen }, opts)   up to opts.limit results, best first
 *
 * objs are the objects that are up now (the same list the radar draws). unseen is what exists but cannot be seen from here right now
 * (below the horizon, or too far to see), as a Map of id -> { why, name, el, az, rangeKm }, so a result can still be picked and the
 * card can say why it is not on the radar. A result is { id, kind, name, detail, up, why, el, az }. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FarGemsSearch = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  // Words that name a whole kind of object, so "planets" or "satellite" lists some.
  const KIND_WORDS = {
    air: ['flight', 'flights', 'plane', 'planes', 'aircraft', 'airplane', 'airplanes'],
    sat: ['satellite', 'satellites', 'sat', 'station', 'stations'],
    star: ['star', 'stars'],
    met: ['meteor', 'meteors', 'shower', 'showers'],
    planet: ['planet', 'planets'],
  };
  const kindOf = (id) => String(id).split(':')[0];
  const isPlanet = (o) => o.kind === 'body' && o.name !== 'Sun' && o.name !== 'Moon';

  // The words of an object that can be searched, as one string: its name first, then the other things it is known by.
  function haystack(o, opts) {
    const parts = [o.name];
    if (o.kind === 'air' && o.ac) {
      parts.push(o.ac.call, o.ac.reg, o.ac.type, o.ac.id);
      const airline = opts && opts.airlineOf && o.ac.call ? opts.airlineOf(o.ac.call) : null;
      if (airline) parts.push(airline);
    } else if (o.kind === 'sat') {
      if (o.norad != null) parts.push(String(o.norad));
    }
    const hay = norm(parts.filter((p) => p != null && p !== '').join(' '));
    return hay + ' ' + hay.replace(/ /g, ''); // and run together, so a registration is found with or without its dash
  }

  // How well the query fits the name: exact 100, starts with 80, a word of it starts with 60, contains 40; found only in the other
  // words 30. 0 when some word of the query is found nowhere.
  function score(tokens, name, hay) {
    const n = norm(name), whole = tokens.join(' ');
    for (const t of tokens) if (!hay.includes(t)) return 0;
    if (n === whole) return 100;
    if (n.startsWith(whole)) return 80;
    if (n.split(' ').some((w) => w.startsWith(tokens[0])) && tokens.every((t) => n.includes(t))) return 60;
    if (n.includes(whole)) return 40;
    return tokens.every((t) => n.includes(t)) ? 35 : 30;
  }

  function search(query, src, opts) {
    const limit = (opts && opts.limit) || 8, q = norm(query);
    if (!q) return [];
    const tokens = q.split(' ');
    const out = [];
    const kindHit = (kind, o) => tokens.length === 1 && (KIND_WORDS[kind] || []).includes(tokens[0]);
    const consider = (o, up) => {
      const planet = o.kind === 'body' && isPlanet(o);
      let s = score(tokens, o.name, haystack(o, opts));
      // the word for a kind of object ("stars", "planet") brings that kind first, ahead of names that merely begin with it
      if (kindHit(o.kind, o) || (planet && kindHit('planet', o))) s = Math.max(s, 90);
      if (!s) return;
      out.push({
        id: o.id, kind: o.kind, name: String(o.name), s: s + (up ? 5 : 0), up,
        detail: o.kind === 'air' && o.ac && o.ac.type ? o.ac.type : '', range: up ? o.range : o.rangeKm,
        el: o.el, az: o.az, why: up ? null : o.why,
      });
    };
    for (const o of (src && src.objs) || []) if (o && o.id && o.name != null) consider(o, true);
    const un = src && src.unseen;
    const entries = un instanceof Map ? [...un] : Array.isArray(un) ? un : [];
    for (const [id, u] of entries) if (id && u && u.name != null) consider({ id, kind: kindOf(id), name: u.name, el: u.el, az: u.az, why: u.why, rangeKm: u.rangeKm, norad: kindOf(id) === 'sat' ? String(id).slice(4) : undefined, ac: kindOf(id) === 'air' ? { id: String(id).slice(4) } : undefined }, false);
    out.sort((a, b) => b.s - a.s || (a.up === b.up ? 0 : a.up ? -1 : 1) || (a.range == null ? 1 : b.range == null ? -1 : a.range - b.range) || a.name.localeCompare(b.name));
    return out.slice(0, limit);
  }

  return { search, norm, haystack, KIND_WORDS };
});
