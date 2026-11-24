/* FarGems: what is flying above you. Client-only, no API keys. */
(() => {
  'use strict';

  const DEG = Math.PI / 180;
  const $ = (s) => document.querySelector(s);
  const statusEl = $('#status');

  const state = {
    lat: null,
    lon: null,
    heading: null,   // compass heading in degrees, when available
    offset: 0,       // manual rotation (drag) or compass calibration offset, degrees
    tab: 'aircraft',
    aircraft: [],
    sats: [],        // {name, satrec}
    satPos: [],      // {name, az, alt, range}
    bodies: [],
    stars: [],
    showers: [],
    cloud: null,
    tleLoadedAt: 0,
  };

  // Pure helpers and static data live in lib/core.js (tested with `npm test`).
  const { STARS, SHOWERS, TLE_URLS, dirName, fmt, lookAngles, parseTLE, catalogNumber, daysToPeak } = window.FarGems;

  const TLE_KEY = 'fg.tle.v1';
  const TLE_MAX_AGE = 6 * 3600 * 1000;
  const LOC_KEY = 'fg.loc.v1';

  // ---------- Helpers ----------

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };

  function setStatus(msg) { statusEl.textContent = msg; }

  // ---------- Location ----------

  function setLocation(lat, lon, save = true) {
    state.lat = lat;
    state.lon = lon;
    if (save) store.set(LOC_KEY, { lat, lon });
    $('#manual').hidden = true;
    refreshAll();
  }

  function showManual() {
    setStatus('Location unavailable.');
    $('#manual').hidden = false;
  }

  function locate() {
    const saved = store.get(LOC_KEY);
    if (!navigator.geolocation) { saved ? setLocation(saved.lat, saved.lon, false) : showManual(); return; }
    setStatus('Finding your location…');
    navigator.geolocation.getCurrentPosition(
      (p) => setLocation(p.coords.latitude, p.coords.longitude),
      () => (saved ? setLocation(saved.lat, saved.lon, false) : showManual()),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  }

  $('#manual').addEventListener('submit', (e) => {
    e.preventDefault();
    const lat = parseFloat($('#mLat').value), lon = parseFloat($('#mLon').value);
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      setLocation(lat, lon);
    }
  });

  // ---------- Aircraft ----------

  async function fetchAircraft() {
    const lat = state.lat, lon = state.lon, nm = 100;
    const sources = [
      `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${nm}`,
      `https://api.airplanes.live/v2/point/${lat}/${lon}/${nm}`,
    ];
    for (const url of sources) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) continue;
        const j = await res.json();
        return (j.ac || []).map((a) => ({
          id: a.hex,
          callsign: (a.flight || '').trim() || a.hex,
          lat: a.lat, lon: a.lon,
          altM: typeof a.alt_baro === 'number' ? a.alt_baro * 0.3048 : 0,
          ground: a.alt_baro === 'ground',
          kt: a.gs, track: a.track,
        })).filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lon));
      } catch { /* try next source */ }
    }
    // OpenSky fallback: bounding box around the observer.
    const dLat = 1.5, dLon = 1.5 / Math.max(0.2, Math.cos(lat * DEG));
    const url = `https://opensky-network.org/api/states/all?lamin=${lat - dLat}&lamax=${lat + dLat}&lomin=${lon - dLon}&lomax=${lon + dLon}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('OpenSky ' + res.status);
    const j = await res.json();
    return (j.states || []).map((s) => ({
      id: s[0], callsign: (s[1] || '').trim() || s[0],
      lon: s[5], lat: s[6], altM: s[7] || 0, ground: !!s[8],
      kt: s[9] != null ? s[9] * 1.94384 : null, track: s[10],
    })).filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lon));
  }

  async function refreshAircraft() {
    if (state.lat == null) return;
    try {
      const list = await fetchAircraft();
      state.aircraft = list.map((a) => ({ ...a, ...lookAngles(state.lat, state.lon, 0, a.lat, a.lon, a.altM) }));
    } catch (err) {
      console.warn('aircraft', err);
      setStatus('Aircraft feeds unavailable right now.');
    }
    renderList(); drawDome();
  }

  // ---------- Satellites ----------

  async function loadTLEs() {
    const cached = store.get(TLE_KEY);
    if (cached && Date.now() - cached.at < TLE_MAX_AGE && cached.items?.length) return cached.items;
    const seen = new Map();
    for (const url of TLE_URLS) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) continue;
        for (const sat of parseTLE(await res.text())) {
          const id = catalogNumber(sat.l1);
          if (!seen.has(id)) seen.set(id, sat);
        }
      } catch { /* keep going with what we have */ }
    }
    const items = [...seen.values()];
    if (items.length) store.set(TLE_KEY, { at: Date.now(), items });
    else if (cached?.items?.length) return cached.items;
    return items;
  }

  function computeSatellites() {
    if (state.lat == null || !state.sats.length) return;
    const now = new Date();
    const gmst = satellite.gstime(now);
    const obsGd = { longitude: state.lon * DEG, latitude: state.lat * DEG, height: 0 };
    state.satPos = [];
    for (const s of state.sats) {
      const pv = satellite.propagate(s.satrec, now);
      if (!pv || !pv.position) continue;
      const ecf = satellite.eciToEcf(pv.position, gmst);
      const la = satellite.ecfToLookAngles(obsGd, ecf);
      state.satPos.push({ name: s.name, az: la.azimuth / DEG, alt: la.elevation / DEG, range: la.rangeSat });
    }
  }

  async function initSatellites() {
    try {
      const items = await loadTLEs();
      state.sats = items.map((s) => ({ name: s.name, satrec: satellite.twoline2satrec(s.l1, s.l2) }));
      state.tleLoadedAt = Date.now();
      computeSatellites(); renderList(); drawDome();
    } catch (err) { console.warn('satellites', err); }
  }

  // ---------- Sun, Moon, planets, stars ----------

  function computeBodies() {
    if (state.lat == null || !window.Astronomy) return;
    const A = Astronomy;
    const obs = new A.Observer(state.lat, state.lon, 0);
    const date = new Date();
    const names = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'];
    state.bodies = names.map((n) => {
      const body = A.Body[n];
      const eq = A.Equator(body, date, obs, true, true);
      const hz = A.Horizon(date, obs, eq.ra, eq.dec, 'normal');
      let extra = '';
      if (n === 'Moon') {
        extra = `${fmt(A.Illumination(body, date).phase_fraction * 100)}% lit`;
      } else if (n !== 'Sun') {
        extra = `mag ${fmt(A.Illumination(body, date).mag, 1)}`;
      }
      return { name: n, az: hz.azimuth, alt: hz.altitude, extra };
    });

    state.stars = STARS.map(([name, ra, dec, mag]) => {
      const hz = A.Horizon(date, obs, ra, dec, 'normal');
      return { name, az: hz.azimuth, alt: hz.altitude, mag };
    });

    state.showers = SHOWERS.map((s) => {
      const hz = A.Horizon(date, obs, s.ra, s.dec, 'normal');
      return { ...s, az: hz.azimuth, alt: hz.altitude, daysTo: daysToPeak(s.m, s.d, date) };
    });
  }

  // ---------- Weather ----------

  async function refreshWeather() {
    if (state.lat == null) return;
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${state.lat}&longitude=${state.lon}&current=cloud_cover`;
      const res = await fetch(url, { cache: 'no-store' });
      const j = await res.json();
      state.cloud = j.current?.cloud_cover ?? null;
      $('#weather').textContent = state.cloud == null ? '' : `Cloud cover now: ${state.cloud}%`;
    } catch { $('#weather').textContent = ''; }
  }

  // ---------- Sky dome ----------

  function viewRotation() {
    return (state.heading ?? 0) + state.offset;
  }

  function drawDome() {
    const c = $('#dome');
    const g = c.getContext('2d');
    const W = c.width, H = c.height, cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 24;
    const css = getComputedStyle(document.documentElement);
    const col = (v) => css.getPropertyValue(v).trim();
    const rot = viewRotation();

    g.clearRect(0, 0, W, H);
    g.fillStyle = col('--sky') || '#0f1830';
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
    g.strokeStyle = col('--line') || '#26304d';
    g.lineWidth = 1;
    for (const alt of [30, 60]) {
      g.beginPath(); g.arc(cx, cy, (90 - alt) / 90 * R, 0, Math.PI * 2); g.stroke();
    }
    g.font = '14px system-ui, sans-serif';
    g.fillStyle = col('--muted') || '#9aa4b8';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const [label, az] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]]) {
      const a = (az - rot) * DEG;
      g.fillText(label, cx + (R + 12) * Math.sin(a), cy - (R + 12) * Math.cos(a));
    }

    const pos = (az, alt) => {
      const r = (90 - alt) / 90 * R;
      const a = (az - rot) * DEG;
      return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
    };
    const dot = (az, alt, color, size, label) => {
      if (alt <= 0 || !Number.isFinite(az) || !Number.isFinite(alt)) return;
      const [x, y] = pos(az, alt);
      g.fillStyle = color;
      g.beginPath(); g.arc(x, y, size, 0, Math.PI * 2); g.fill();
      if (label) { g.textAlign = 'left'; g.fillText(label, x + size + 3, y); }
    };

    for (const s of state.stars) dot(s.az, s.alt, '#e8ecf5', Math.max(1.2, 3 - s.mag * 0.6));
    for (const a of state.aircraft) if (!a.ground) dot(a.az, a.alt, '#60a5fa', 3);
    for (const s of state.satPos) dot(s.az, s.alt, '#fb923c', 4, /ISS|TIANGONG|CSS/i.test(s.name) ? s.name : '');
    const sunColor = { Sun: '#fde047', Moon: '#e5e7eb' };
    for (const b of state.bodies) dot(b.az, b.alt, sunColor[b.name] || '#fcd9a0', b.name === 'Sun' || b.name === 'Moon' ? 7 : 4, b.name);

    g.strokeStyle = col('--line') || '#26304d';
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();

    const rotLabel = state.heading != null
      ? `Facing ${fmt(state.heading)}° ${dirName(state.heading)}`
      : 'Drag the dome to rotate';
    $('#headingLabel').textContent = rotLabel;
  }

  // Drag to rotate (fallback when no compass).
  (() => {
    const c = $('#dome');
    let drag = null;
    c.addEventListener('pointerdown', (e) => { drag = { x: e.clientX }; c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointermove', (e) => {
      if (!drag) return;
      state.offset = (state.offset + (e.clientX - drag.x) * 0.5) % 360;
      drag.x = e.clientX;
      drawDome();
    });
    const end = () => { drag = null; };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  })();

  // Compass via DeviceOrientation (iOS needs a permission prompt from a tap).
  function onOrientation(e) {
    let h = null;
    if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
    else if (e.absolute && typeof e.alpha === 'number') h = (360 - e.alpha) % 360;
    if (h != null) { state.heading = h; drawDome(); }
  }

  async function enableCompass() {
    try {
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        const r = await DeviceOrientationEvent.requestPermission();
        if (r !== 'granted') return;
      }
      window.addEventListener('deviceorientationabsolute', onOrientation);
      window.addEventListener('deviceorientation', onOrientation);
      $('#compassBtn').hidden = true;
    } catch (err) { console.warn('compass', err); }
  }

  if ('DeviceOrientationEvent' in window) {
    const btn = $('#compassBtn');
    btn.hidden = false;
    btn.addEventListener('click', enableCompass);
  }

  // ---------- List ----------

  function renderList() {
    const ul = $('#items');
    const rows = [];
    const add = (name, meta) => rows.push([name, meta]);

    switch (state.tab) {
      case 'aircraft':
        state.aircraft.filter((a) => a.alt > 0 && !a.ground)
          .sort((a, b) => b.alt - a.alt).slice(0, 60)
          .forEach((a) => add(a.callsign, `${fmt(a.alt)}° up · ${dirName(a.az)} · ${fmt(a.altM / 0.3048)} ft${a.kt ? ` · ${fmt(a.kt)} kt` : ''}`));
        break;
      case 'satellites':
        state.satPos.filter((s) => s.alt > 0).sort((a, b) => b.alt - a.alt)
          .forEach((s) => add(s.name, `${fmt(s.alt)}° up · ${dirName(s.az)} · ${fmt(s.range)} km`));
        if (!state.satPos.length) add('Loading satellite orbits…', '');
        break;
      case 'bodies':
        state.bodies.forEach((b) => add(b.name, `${fmt(b.alt)}° ${b.alt > 0 ? 'up' : 'below'} · ${dirName(b.az)}${b.extra ? ' · ' + b.extra : ''}`));
        break;
      case 'stars':
        state.stars.filter((s) => s.alt > 0).sort((a, b) => a.mag - b.mag)
          .forEach((s) => add(s.name, `mag ${fmt(s.mag, 2)} · ${fmt(s.alt)}° up · ${dirName(s.az)}`));
        break;
      case 'showers':
        state.showers.slice().sort((a, b) => a.daysTo - b.daysTo).forEach((s) => {
          const when = Math.abs(s.daysTo) <= 7
            ? 'active now'
            : `peak in ${Math.round(s.daysTo)} d`;
          add(s.name, `${when} · ZHR ~${s.zhr}${s.alt > 0 ? ` · radiant ${fmt(s.alt)}° up` : ''}`);
        });
        break;
    }

    ul.textContent = '';
    if (!rows.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = state.lat == null ? 'Waiting for location…' : 'Nothing above the horizon right now.';
      ul.appendChild(li);
      return;
    }
    for (const [name, meta] of rows) {
      const li = document.createElement('li');
      const strong = document.createElement('strong');
      strong.textContent = name;
      const m = document.createElement('span');
      m.className = 'meta';
      m.textContent = meta;
      li.append(strong, m);
      ul.appendChild(li);
    }
  }

  document.querySelectorAll('.filters button').forEach((b) => {
    b.addEventListener('click', () => {
      state.tab = b.dataset.tab;
      document.querySelectorAll('.filters button').forEach((x) => x.classList.toggle('active', x === b));
      renderList();
    });
  });

  // ---------- Refresh loops ----------

  function refreshAll() {
    setStatus(`Observing from ${state.lat.toFixed(2)}, ${state.lon.toFixed(2)}`);
    computeBodies();
    refreshAircraft();
    refreshWeather();
    computeSatellites();
    renderList();
    drawDome();
  }

  setInterval(() => { if (state.lat != null) { computeSatellites(); renderList(); drawDome(); } }, 2000);
  setInterval(() => { if (state.lat != null) { computeBodies(); renderList(); drawDome(); } }, 30000);
  setInterval(refreshAircraft, 15000);
  setInterval(refreshWeather, 10 * 60 * 1000);
  setInterval(() => { if (Date.now() - state.tleLoadedAt > TLE_MAX_AGE) initSatellites(); }, 60 * 60 * 1000);

  // ---------- Boot ----------

  function boot() {
    if (!window.satellite || !window.Astronomy) {
      setStatus('Calculation libraries failed to load. Check your connection and reload.');
    }
    initSatellites();
    locate();
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch((err) => console.warn('sw', err));
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
