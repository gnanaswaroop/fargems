/* FarGems landing: asks for location and compass, then shows the page in its "ready" state.
 * It also offers to install the app. Decisions live in lib/onboarding.js (tested). */
(() => {
  'use strict';
  const O = window.FarGemsOnboarding;
  const $ = (s) => document.querySelector(s);

  // The hero picture moves; hold it still for visitors who ask their device for less motion.
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { const h = $('.hero'); if (h && h.pauseAnimations) h.pauseAnimations(); }
  } catch { /* the picture just keeps moving */ }

  // localStorage can be blocked (private mode, some embedded browsers); fall back to memory.
  const storage = (() => {
    try { const k = '__fg_probe'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return localStorage; }
    catch { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; }
  })();

  const els = {
    allow: $('#allowBtn'), allowAgain: $('#allowAgainBtn'), sample: $('#sampleBtn'), msg: $('#msg'),
    loc: $('#locState'), compass: $('#compassState'), open: $('#openLink'),
    form: $('#manualForm'), input: $('#manualLoc'),
    installCard: $('#installCard'), installText: $('#installText'), installBtn: $('#installBtn'),
    menuBtn: $('#menuBtn'), menuList: $('#menuList'),
  };

  // The "..." menu at the top right (About, GitHub). Closes on a tap elsewhere, on Escape, and when a link is used.
  function setMenu(open) {
    els.menuList.hidden = !open;
    els.menuBtn.setAttribute('aria-expanded', String(open));
  }
  els.menuBtn.addEventListener('click', (e) => { e.stopPropagation(); setMenu(els.menuList.hidden); });
  document.addEventListener('click', (e) => { if (!els.menuList.hidden && !els.menuList.contains(e.target)) setMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !els.menuList.hidden) { setMenu(false); els.menuBtn.focus(); } });

  let attempted = false;   // the visitor has answered the permission prompts this visit
  let deferredInstall = null;

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

  // Draw the page from the current state, so every change goes through one place.
  function render() {
    const hasLocation = !!O.readLocation(storage);
    const compass = O.readCompass(storage) || (O.compassNeedsPermission(window) ? null : 'na');
    const s = O.landingState({ hasLocation, attempted, compass });
    els.allow.hidden = !s.showAllow;
    els.allow.disabled = false;
    els.sample.hidden = !s.showSample;
    els.allowAgain.hidden = !s.showAllowAgain;
    els.open.hidden = !s.showOpen;
    els.form.hidden = !s.showForm;
    els.loc.textContent = hasLocation ? 'Allowed' : (attempted ? 'Not shared' : 'Not asked yet');
    els.compass.textContent = s.compassText;
    if (s.phase === 'ready') els.msg.textContent = 'You are set. Open the sky view to see what is above you.';
    else if (s.phase === 'manual') els.msg.textContent = 'Enter your coordinates below to continue.';
    else els.msg.textContent = '';
    renderInstall();
  }

  // Ask for both permissions. The compass request must start synchronously inside the tap (iOS).
  function askPermissions() {
    attempted = true;
    els.allow.disabled = true;
    els.msg.textContent = 'Waiting for your answer…';
    const compassP = O.compassNeedsPermission(window)
      ? DeviceOrientationEvent.requestPermission().then((r) => (r === 'granted' ? 'granted' : 'denied'), () => 'denied')
      : Promise.resolve('na');
    const locP = requestLocation();
    Promise.all([compassP, locP]).then(([compass, loc]) => {
      O.storeCompass(storage, compass);
      if (loc) O.storeLocation(storage, loc.lat, loc.lon);
      render();
    });
  }

  els.allow.addEventListener('click', askPermissions);
  els.allowAgain.addEventListener('click', askPermissions);

  // The sample location opens the sky view directly, with no permissions needed.
  els.sample.addEventListener('click', () => {
    const s = O.SAMPLE_LOCATION;
    if (O.storeLocation(storage, s.lat, s.lon)) location.href = 'viewer.html';
    else els.msg.textContent = 'Could not save the sample location on this device.';
  });

  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const c = O.parseCoords(els.input.value);
    if (!c || !O.storeLocation(storage, c.lat, c.lon)) {
      els.msg.textContent = 'Use "latitude, longitude", e.g. 22.57, 88.36';
      return;
    }
    render();
  });

  // Install: browsers that fire beforeinstallprompt get a button. iOS gets instructions instead.
  const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; renderInstall(); });
  window.addEventListener('appinstalled', () => { deferredInstall = null; renderInstall(); });

  function renderInstall() {
    const mode = O.installMode({ standalone, ios, hasPrompt: !!deferredInstall });
    els.installCard.hidden = mode === 'hidden' || mode === 'none';
    els.installBtn.hidden = mode !== 'prompt';
    if (mode === 'prompt') els.installText.textContent = 'Add FarGems to your home screen for a full-screen app.';
    if (mode === 'ios') els.installText.textContent = 'On iPhone or iPad: tap Share, then Add to Home Screen.';
  }

  els.installBtn.addEventListener('click', async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    await deferredInstall.userChoice;
    deferredInstall = null;
    renderInstall();
  });

  render();
})();
