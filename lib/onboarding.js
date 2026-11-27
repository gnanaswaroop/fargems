/* FarGems onboarding: pure helpers for the landing page and the viewer's start-up choices.
 * `storage` is any object with getItem/setItem (localStorage in the browser, a fake in tests).
 * Browser: plain <script> exposing window.FarGemsOnboarding. Node: require() for tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FarGemsOnboarding = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // Sample location for trying the app without sharing your own position.
  const SAMPLE_LOCATION = Object.freeze({ lat: 17.4435, lon: 78.3772 });

  const LOC_KEY = 'fg.loc';         // same key the viewer uses
  const COMPASS_KEY = 'fg.compass'; // 'granted' | 'denied' | 'na'

  const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
  const validLat = (lat) => isNum(lat) && Math.abs(lat) <= 90;
  const validLon = (lon) => isNum(lon) && Math.abs(lon) <= 180;

  // Accepts "22.57, 88.36", "22.57 88.36" or "-33.9 151.2". Returns {lat, lon} or null.
  function parseCoords(text) {
    const m = String(text ?? '').match(/(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)/);
    if (!m) return null;
    const lat = parseFloat(m[1]), lon = parseFloat(m[2]);
    return validLat(lat) && validLon(lon) ? { lat, lon } : null;
  }

  // Store a location for the viewer. Returns false (and stores nothing) if out of range.
  function storeLocation(storage, lat, lon) {
    if (!validLat(lat) || !validLon(lon)) return false;
    try { storage.setItem(LOC_KEY, JSON.stringify({ lat, lon })); return true; } catch { return false; }
  }

  // Read the stored location, or null if none or corrupt.
  function readLocation(storage) {
    try {
      const v = JSON.parse(storage.getItem(LOC_KEY));
      return v && validLat(v.lat) && validLon(v.lon) ? { lat: v.lat, lon: v.lon } : null;
    } catch { return null; }
  }

  // Record the compass outcome. `state` must be 'granted', 'denied' or 'na' (no permission needed).
  function storeCompass(storage, state) {
    if (!['granted', 'denied', 'na'].includes(state)) return false;
    try { storage.setItem(COMPASS_KEY, state); return true; } catch { return false; }
  }

  function readCompass(storage) {
    try { return storage.getItem(COMPASS_KEY); } catch { return null; }
  }

  // iPhone and iPad (iOS 13 and later) need DeviceOrientationEvent.requestPermission() from a user tap. Other platforms
  // don't. Some other browsers now have that function too, and answer "granted" without asking anyone, so having it is
  // not enough: the device has to be an Apple one. (An iPad in "desktop site" mode says it is a Mac; a Mac with a touch
  // screen is an iPad.) An environment with no navigator at all (a test) is judged by the function alone.
  function isAppleTouchDevice(env) {
    const nav = env && env.navigator;
    if (!nav) return true;
    return /iphone|ipad|ipod/i.test(nav.userAgent || '') || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  }
  function compassNeedsPermission(env) {
    const DOE = env && env.DeviceOrientationEvent;
    return !!DOE && typeof DOE.requestPermission === 'function' && isAppleTouchDevice(env);
  }

  // The viewer turns the compass on by itself when it was granted, or when this device needs no permission for it
  // (Android and desktop: the landing page records "na", and a visitor who skipped the landing page has nothing stored).
  // It stays off after a refusal, and on iPhone until a tap has granted it.
  function shouldAutoEnableCompass(storage, env) {
    const v = readCompass(storage);
    if (v === 'granted' || v === 'na') return true;
    if (v === 'denied') return false;
    return !!env && !compassNeedsPermission(env);
  }

  // Where to send the visitor from the landing page: straight into the viewer once a location is known.
  function startTarget(storage) {
    return readLocation(storage) ? 'viewer.html' : null;
  }

  // What the landing page shows. `attempted` is true once the visitor has answered the permission prompts.
  // After location is granted the page becomes "ready": the permission button goes, the sky view button appears.
  function landingState({ hasLocation, attempted = false, compass = null } = {}) {
    const compassText = {
      granted: 'Allowed',
      denied: 'Not allowed. The sky view still works: drag to rotate.',
      na: 'Not needed on this device',
    }[compass] || 'Not asked yet';
    if (hasLocation) {
      return {
        phase: 'ready', showAllow: false, showSample: false, showOpen: true, showForm: false,
        showAllowAgain: true, compassText,
      };
    }
    if (attempted) {
      return {
        phase: 'manual', showAllow: false, showSample: true, showOpen: false, showForm: true,
        showAllowAgain: false, compassText,
      };
    }
    return {
      phase: 'ask', showAllow: true, showSample: true, showOpen: false, showForm: false,
      showAllowAgain: false, compassText,
    };
  }

  // How to offer installing the app. Browsers that fire beforeinstallprompt get a button;
  // iOS has no prompt, so it gets instructions instead; any other browser is pointed to its own menu.
  function installMode({ standalone = false, installed = false, ios = false, hasPrompt = false } = {}) {
    if (standalone || installed) return 'hidden';
    if (hasPrompt) return 'prompt';
    if (ios) return 'ios';
    return 'manual'; // the browser has not offered an install prompt (yet): point to its own menu
  }

  // The browser tells the page when the visitor installs the app (the appinstalled event), and that is the only time it
  // does: a later visit in a normal browser tab cannot ask. So the page writes it down. A browser that offers the install
  // prompt (beforeinstallprompt) does so only while the app is not installed, so that clears the note again.
  const INSTALLED_KEY = 'fg.installed';
  function storeInstalled(storage, on) {
    try { if (on) storage.setItem(INSTALLED_KEY, '1'); else storage.setItem(INSTALLED_KEY, '0'); return true; } catch { return false; }
  }
  function readInstalled(storage) {
    try { return storage.getItem(INSTALLED_KEY) === '1'; } catch { return false; }
  }

  // Telling others about the app. One short text that fits a WhatsApp message or a tweet (the address adds about 25 characters):
  // the line the app is known by, then what it does in one breath. The address is the site this page is served from.
  const SHARE_TITLE = 'FarGems: what’s flying above you';
  const SHARE_TEXT = 'Try this: look up, then open FarGems. It names the planes, the ISS, planets and the Moon above you right now, on a live radar or through your phone’s camera. Free, no sign-up. 🔭';
  function appShare(loc) {
    const l = loc || {};
    const url = String(l.origin || '') + String(l.pathname || '/').replace(/[^/]*$/, '');
    return { title: SHARE_TITLE, text: SHARE_TEXT, url };
  }
  // Share it through the phone's share sheet (WhatsApp, X, Messages and so on), or copy the text and the address when the
  // browser has no share sheet. Resolves to 'shared', 'copied', 'cancelled' (the visitor closed the sheet) or 'failed'.
  async function shareApp(env) {
    const nav = (env && env.navigator) || {}, data = appShare(env && env.location);
    try {
      if (typeof nav.share === 'function') { await nav.share(data); return 'shared'; }
      if (nav.clipboard && typeof nav.clipboard.writeText === 'function') { await nav.clipboard.writeText(data.text + ' ' + data.url); return 'copied'; }
    } catch (e) { return e && e.name === 'AbortError' ? 'cancelled' : 'failed'; }
    return 'failed';
  }

  // What to tell a visitor who asks to install when the browser has no install prompt to start: how to do it from the menu.
  function installHelp({ ios = false } = {}) {
    return ios ? 'On iPhone or iPad: tap the Share button, then Add to Home Screen.' : 'Open your browser menu and choose Install app, or Add to Home screen.';
  }

  // The words for the permission card. Only iPhone and iPad ask for the compass; everywhere else it is simply on, so
  // the page asks for the location only.
  function permissionCopy({ needsCompass = false } = {}) {
    return needsCompass
      ? { title: 'Two permissions', button: 'Allow location and compass', hero: 'Allow location and compass', showCompass: true, privacy: 'Location and compass stay on your device.' }
      : { title: 'One permission', button: 'Allow location', hero: 'Allow location', showCompass: false, privacy: 'Your location stays on your device.' };
  }

  // What a failed position lookup means. Code 1 is "the visitor said no" (or the device blocks it). Anything else (the
  // device cannot work out a position, such as a tablet without GPS and with network location off, or it took too long)
  // is not a refusal, and the sky view can carry on with an area guessed from the network.
  function geoFailure(code) {
    return code === 1 ? 'denied' : 'unavailable';
  }

  return {
    INSTALLED_KEY, storeInstalled, readInstalled, installHelp, SHARE_TITLE, SHARE_TEXT, appShare, shareApp, permissionCopy, geoFailure,
    LOC_KEY, COMPASS_KEY, SAMPLE_LOCATION, parseCoords, storeLocation, readLocation, storeCompass, readCompass,
    compassNeedsPermission, shouldAutoEnableCompass, startTarget, landingState, installMode,
  };
});
