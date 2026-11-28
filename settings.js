/* FarGems settings: writes the choices the sky view reads on load.
 * Keys: fg.loc (location), fg.compass (permission), fg.flip ('1'/'0'), fg.unit ('C'/'F'), fg.visOnly ('1'/'0'), fg.units ('metric'/'imperial'/'aviation'), fg.far ('units'/'au'/'light'), fg.autoAr ('1'/'0'), fg.arSymbols ('1'/'0'), fg.flightRange (km), fg.layers (JSON). */
(() => {
  'use strict';
  const L = window.FarGemsLogic;
  const O = window.FarGemsOnboarding;
  const $ = (s) => document.querySelector(s);

  const storage = (() => {
    try { const k = '__fg_probe'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return localStorage; }
    catch { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; }
  })();
  const reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const msg = (t) => { $('#settingsMsg').textContent = t; };

  function showLocation() {
    const l = O.readLocation(storage);
    $('#settingsLoc').textContent = l ? `${l.lat.toFixed(2)}°, ${l.lon.toFixed(2)}°` : 'Not set';
  }

  function showCompass() {
    const c = O.readCompass(storage);
    $('#compassState').textContent = { granted: 'Allowed', denied: 'Not allowed', na: 'Not needed on this device' }[c] || 'Not asked yet';
  }

  // Location: use the device, enter coordinates, or use the sample.
  $('#geoBtn').addEventListener('click', () => {
    if (!navigator.geolocation) { msg('Location is not available on this device. Enter coordinates instead.'); return; }
    msg('Locating…');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        if (O.storeLocation(storage, p.coords.latitude, p.coords.longitude)) { msg('Location saved.'); showLocation(); }
        else msg('That location is not valid.');
      },
      () => msg('Location was not shared. Enter coordinates instead.'),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 },
    );
  });

  $('#manualForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const c = O.parseCoords($('#manualLoc').value);
    if (c && O.storeLocation(storage, c.lat, c.lon)) { msg('Location saved.'); showLocation(); }
    else msg('Use "latitude, longitude", e.g. 22.57, 88.36');
  });

  $('#sampleBtn').addEventListener('click', () => {
    const s = O.SAMPLE_LOCATION;
    if (O.storeLocation(storage, s.lat, s.lon)) { msg('Sample location saved.'); showLocation(); }
  });

  // Calibrate: the camera view does the lining up; this shows the correction it saved, and clears it.
  function showCal() {
    const off = window.FarGemsAR ? window.FarGemsAR.parseOffset(storage.getItem('fg.arOffset')) : { h: 0, p: 0 };
    const f = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + '°';
    $('#calState').textContent = Math.abs(off.h) < 0.05 && Math.abs(off.p) < 0.05 ? 'None' : 'heading ' + f(off.h) + ', tilt ' + f(off.p);
  }
  $('#calReset').addEventListener('click', () => { storage.setItem('fg.arOffset', JSON.stringify({ h: 0, p: 0 })); showCal(); msg('Correction cleared.'); });
  showCal();

  // Compass: the request must start inside the tap (iOS). Other devices need no permission.
  $('#compassBtn').addEventListener('click', () => {
    if (!O.compassNeedsPermission(window)) { O.storeCompass(storage, 'na'); showCompass(); return; }
    DeviceOrientationEvent.requestPermission()
      .then((r) => { O.storeCompass(storage, r === 'granted' ? 'granted' : 'denied'); showCompass(); })
      .catch(() => { O.storeCompass(storage, 'denied'); showCompass(); });
  });

  // Display choices.
  $('#flipToggle').checked = storage.getItem('fg.flip') !== '0';
  $('#flipToggle').addEventListener('change', (e) => storage.setItem('fg.flip', e.target.checked ? '1' : '0'));
  $('#visOnlyToggle').checked = L.parseVisOnly(storage.getItem('fg.visOnly'));
  $('#visOnlyToggle').addEventListener('change', (e) => storage.setItem('fg.visOnly', e.target.checked ? '1' : '0'));
  $('#autoArToggle').checked = L.parseAutoAr(storage.getItem('fg.autoAr'));
  $('#autoArToggle').addEventListener('change', (e) => storage.setItem('fg.autoAr', e.target.checked ? '1' : '0'));
  // Ticked means the virtual objects are shown in the AR view (the usual); the saved value is 1 for shown and 0 for hidden.
  $('#arSymbolsToggle').checked = L.parseArSymbols(storage.getItem('fg.arSymbols'));
  $('#arSymbolsToggle').addEventListener('change', (e) => storage.setItem('fg.arSymbols', e.target.checked ? '1' : '0'));
  // Farthest flight to show (km). The saved value is the cleaned-up number, so the box always shows what is used.
  $('#flightRange').value = L.parseFlightRange(storage.getItem('fg.flightRange'));
  $('#flightRange').addEventListener('change', (e) => {
    const km = L.parseFlightRange(e.target.value);
    e.target.value = km; storage.setItem('fg.flightRange', String(km));
  });
  $('#unitsSelect').value = L.parseUnits(storage.getItem('fg.units'), navigator.language);
  $('#unitsSelect').addEventListener('change', (e) => storage.setItem('fg.units', L.parseUnits(e.target.value)));
  $('#farSelect').value = L.parseFar(storage.getItem('fg.far'));
  $('#farSelect').addEventListener('change', (e) => storage.setItem('fg.far', L.parseFar(e.target.value)));
  $('#unitSelect').value = L.parseUnit(storage.getItem('fg.unit'));
  $('#unitSelect').addEventListener('change', (e) => storage.setItem('fg.unit', L.parseUnit(e.target.value)));

  // Share the app: the share sheet, or copy the text and the address.
  $('#shareApp').addEventListener('click', async () => {
    const r = await O.shareApp({ navigator, location });
    msg(r === 'shared' ? 'Thanks for sharing FarGems.' : r === 'copied' ? 'Copied. Paste it anywhere to share.' : r === 'cancelled' ? '' : 'Could not share from here.');
  });
  // Layers: one checkbox per layer. The saved choices are read back, so a reload shows the truth.
  function currentLayers() {
    let raw = null;
    try { raw = storage.getItem('fg.layers'); } catch { /* blocked */ }
    return L.loadLayers(raw, reduced);
  }
  function renderLayers() {
    const layers = currentLayers();
    $('#layerList').innerHTML = L.LAYER_KEYS.map((k) =>
      `<label class="layer-row"><input type="checkbox" data-layer="${k}"${layers[k] ? ' checked' : ''}> ${L.LAYER_LABELS[k]}</label>`).join('');
  }
  $('#layerList').addEventListener('change', (e) => {
    const k = e.target.dataset.layer;
    if (!k) return;
    storage.setItem('fg.layers', JSON.stringify(L.toggleLayer(currentLayers(), k)));
  });

  showLocation();
  showCompass();
  // Only iPhone and iPad ask for the compass. Everywhere else there is nothing to allow, so the card is not shown.
  if (!O.compassNeedsPermission(window)) { const card = $('#compassBtn').closest('section'); if (card) card.hidden = true; }
  renderLayers();
})();
