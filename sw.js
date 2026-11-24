'use strict';
// FarGems service worker: caches the app shell and the two CDN libraries so the app
// opens offline. Live data APIs are never cached here (the app keeps its own TLE cache).
const VERSION = 'fargems-v1';
const SHELL = ['./', 'index.html', 'landing.js', 'viewer.html', 'style.css', 'lib/logic.js', 'lib/onboarding.js', 'app.js', 'manifest.webmanifest',
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

  if (url.origin === self.location.origin) {
    // stale-while-revalidate for the app shell
    e.respondWith(caches.open(VERSION).then(async cache => {
      const hit = await cache.match(req, { ignoreSearch: true });
      const net = fetch(req).then(res => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => hit);
      return hit || net;
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
