'use strict';
// FarGems service worker: caches the app shell and the two CDN libraries so the app
// opens offline. Live data APIs are never cached here (the app keeps its own TLE cache).
// Bump VERSION whenever this file's caching behaviour changes: activating a new version deletes
// the older caches, so stale files cannot linger.
const VERSION = 'fargems-v3';
const SHELL = ['./', 'index.html', 'about.html', 'landing.js', 'viewer.html', 'settings.html', 'settings.js', 'config.js', 'style.css', 'lib/update.js', 'update.js', 'nav.js', 'icon-maskable-512.png', 'lib/logic.js', 'lib/onboarding.js', 'lib/permalink.js', 'lib/search.js', 'lib/preview.js', 'assets/moon-full.jpg', 'lib/declination.js', 'lib/ar.js', 'lib/moon.js', 'ar-view.js', 'app.js', 'manifest.webmanifest',
  'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
const CDN_HOSTS = ['cdn.jsdelivr.net'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.endsWith('/version.json')) return; // always straight from the network, and never stored: it says what is live now

  if (url.origin === self.location.origin) {
    // Network first for the app's own files, so a new deploy shows straight away. `no-cache` makes the
    // browser revalidate instead of reusing a copy from its HTTP cache (the CDN may allow hours of caching).
    // Offline, or on a server error, the cached copy is served.
    e.respondWith(caches.open(VERSION).then(async cache => {
      try {
        const res = await fetch(req, { cache: 'no-cache' });
        if (res && res.ok) {
          cache.put(req, res.clone());
          return res;
        }
        const hit = await cache.match(req, { ignoreSearch: true });
        return hit || res;
      } catch (err) {
        const hit = await cache.match(req, { ignoreSearch: true });
        if (hit) return hit;
        throw err;
      }
    }));
  } else if (CDN_HOSTS.includes(url.hostname)) {
    // cache-first for versioned library files
    e.respondWith(caches.open(VERSION).then(async cache => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    }));
  }
  // everything else (data APIs) goes straight to the network
});
