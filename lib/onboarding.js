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
  const SAMPLE_LOCATION = Object.freeze({ lat: 17.460864206181917, lon: 78.32779313373987 });

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

  // iOS 13+ needs DeviceOrientationEvent.requestPermission() from a user tap. Other platforms don't.
  function compassNeedsPermission(env) {
    const DOE = env && env.DeviceOrientationEvent;
    return !!DOE && typeof DOE.requestPermission === 'function';
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
  function installMode({ standalone = false, ios = false, hasPrompt = false } = {}) {
    if (standalone) return 'hidden';
    if (hasPrompt) return 'prompt';
    if (ios) return 'ios';
    return 'manual'; // the browser has not offered an install prompt (yet): point to its own menu
  }

  return {
    LOC_KEY, COMPASS_KEY, SAMPLE_LOCATION, parseCoords, storeLocation, readLocation, storeCompass, readCompass,
    compassNeedsPermission, shouldAutoEnableCompass, startTarget, landingState, installMode,
  };
});
