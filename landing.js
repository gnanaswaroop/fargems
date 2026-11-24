/* FarGems landing: asks for location and compass up front, then opens the sky view.
 * Logic that can be tested lives in lib/onboarding.js. */
(() => {
  'use strict';
  const O = window.FarGemsOnboarding;
  const $ = (s) => document.querySelector(s);

  // localStorage can be blocked (private mode, some embedded browsers); fall back to memory.
  const storage = (() => {
    try { const k = '__fg_probe'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return localStorage; }
    catch { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; }
  })();

  const els = { allow: $('#allowBtn'), msg: $('#msg'), loc: $('#locState'), compass: $('#compassState'), open: $('#openLink'), form: $('#manualForm'), input: $('#manualLoc') };

  // Resolve with {lat, lon} or null. Never rejects.
  function requestLocation() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 },
      );
    });
  }

  function showOpen(msg) {
    els.open.hidden = false;
    els.msg.textContent = msg;
  }

  function showCompassState(state) {
    const text = {
      granted: 'Allowed',
      denied: 'Not allowed. The sky view still works: drag to rotate.',
      na: 'Not needed on this device',
    }[state] || 'Not asked yet';
    els.compass.textContent = text;
  }

  // The tap handler must start the compass request synchronously (iOS rejects it otherwise).
  els.allow.addEventListener('click', () => {
    els.allow.disabled = true;
    els.msg.textContent = 'Waiting for your answer…';

    const compassP = O.compassNeedsPermission(window)
      ? DeviceOrientationEvent.requestPermission().then((r) => (r === 'granted' ? 'granted' : 'denied'), () => 'denied')
      : Promise.resolve('na');
    const locP = requestLocation();

    Promise.all([compassP, locP]).then(([compass, loc]) => {
      O.storeCompass(storage, compass);
      showCompassState(compass);

      if (loc && O.storeLocation(storage, loc.lat, loc.lon)) {
        els.loc.textContent = 'Allowed';
        els.msg.textContent = 'Opening the sky view…';
        setTimeout(() => { location.href = O.startTarget(storage) || 'viewer.html'; }, 800);
        els.open.hidden = false;
        return;
      }
      els.loc.textContent = 'Not shared';
      els.form.hidden = false;
      els.allow.hidden = true;
      els.msg.textContent = 'Enter your coordinates below to continue.';
      els.input.focus();
    });
  });

  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const c = O.parseCoords(els.input.value);
    if (!c || !O.storeLocation(storage, c.lat, c.lon)) {
      els.msg.textContent = 'Use "latitude, longitude", e.g. 22.57, 88.36';
      return;
    }
    location.href = 'viewer.html';
  });

  // On a return visit, show what is already allowed instead of asking again.
  function init() {
    const saved = O.readLocation(storage);
    const savedCompass = O.readCompass(storage);
    if (saved) els.loc.textContent = 'Allowed';
    if (savedCompass) showCompassState(savedCompass);
    else if (!O.compassNeedsPermission(window)) showCompassState('na');
    if (saved) {
      els.allow.textContent = 'Allow again';
      showOpen('Your location is saved on this device.');
    }
  }
  init();
})();
