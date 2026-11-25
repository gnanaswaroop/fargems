/* FarGems: offers a reload when a newer version of the site has been published.
 * Two signals: version.json on the server no longer matches the build this page was made from (checked when the page is
 * shown and every 10 minutes), or the service worker was replaced while the page was open. Logic is in lib/update.js. */
(() => {
  'use strict';
  const U = window.FarGemsUpdate;
  if (!U) return;
  const current = U.parseBuild((window.FARGEMS_CONFIG || {}).build);
  let shown = false, lastCheck = 0;

  // The build the visitor last reloaded for, kept for the tab session: if the reload did not help, do not ask again.
  const KEY = 'fg.reloadedFor';
  function remembered() { try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; } }

  function showBar(latest) {
    if (shown || !document.body) return;
    shown = true;
    const bar = document.createElement('div');
    bar.id = 'updateBar'; bar.className = 'update-bar'; bar.setAttribute('role', 'status');
    const text = document.createElement('span');
    text.textContent = 'A new version of FarGems is available.';
    const reload = document.createElement('button');
    reload.type = 'button'; reload.className = 'btn primary'; reload.textContent = 'Reload';
    reload.addEventListener('click', () => {
      try { if (latest) sessionStorage.setItem(KEY, latest); } catch { /* private mode */ }
      const go = () => location.reload();
      try { navigator.serviceWorker.getRegistration().then((r) => (r ? r.update() : null)).then(go, go); } catch { go(); }
    });
    const later = document.createElement('button');
    later.type = 'button'; later.className = 'link'; later.textContent = 'Later';
    later.addEventListener('click', () => bar.remove());
    bar.append(text, reload, later);
    document.body.append(bar);
  }

  async function check() {
    if (!current || shown) return;
    const now = Date.now();
    if (!U.shouldCheck(lastCheck, now)) return;
    lastCheck = now;
    try {
      const res = await fetch(U.versionUrl(now), { cache: 'no-store' });
      if (!res.ok) return;
      const latest = (await res.json()).build;
      if (U.isStale(current, latest) && !U.alreadyTried(remembered(), latest)) showBar(latest);
    } catch { /* offline: try again later */ }
  }

  check();
  setInterval(check, 10 * 60e3);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });

  if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller; // the first install is not an update
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) showBar(); });
  }
})();
