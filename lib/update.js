/* FarGems: noticing that a newer version has been published than the one running in this page.
 * The deploy writes the build id into config.js (what this page was built from) and into version.json (what is live now).
 * When they differ the page is old, and update.js offers a reload. Pure helpers, so they can be tested without a browser. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FarGemsUpdate = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // A build id is the commit the site was built from. Anything else (missing, odd characters, too long) means "unknown".
  function parseBuild(v) {
    const s = String(v == null ? '' : v).trim();
    return /^[0-9A-Za-z._-]{1,64}$/.test(s) ? s : '';
  }

  // Stale only when both ids are known and they differ. A local copy has no id, so it never nags.
  function isStale(current, latest) {
    const a = parseBuild(current), b = parseBuild(latest);
    return !!a && !!b && a !== b;
  }

  // The address of version.json with a changing query, so no cache (browser or CDN) can answer with an old copy.
  function versionUrl(now) { return 'version.json?t=' + Math.floor(now); }

  // Do not ask the server more than once in a few minutes, however often the page is shown again.
  function shouldCheck(lastCheckAt, now, minGapMs = 5 * 60e3) { return !lastCheckAt || now - lastCheckAt >= minGapMs; }

  // A reload that did not bring the new build (something between the visitor and the site still answers with old files)
  // must not leave the bar on, asking again and again. `tried` is the build id the visitor already reloaded for.
  function alreadyTried(tried, latest) { const b = parseBuild(latest); return !!b && parseBuild(tried) === b; }

  return { parseBuild, isStale, versionUrl, shouldCheck, alreadyTried };
});
