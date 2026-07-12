/* Pixfix service worker — makes it a real installable app and lets the
   shell (piano, drawing, themes, today's deck) work with no connection.
   Videos and fresh thumbnails still need the network, as expected.

   CACHE VERSIONING (hard requirement): bump CACHE on every deploy that changes
   shell assets. The app HTML itself is served NETWORK-FIRST (see below) so a new
   deploy reaches devices on the next reload without waiting for a manual bump —
   the cache-first-for-HTML mistake in v7 is what made 4a/4b invisible on already-
   installed devices. Offline still falls back to the cached copy, so the PWA
   survives with no connection.                                                */
const CACHE = 'pixfix-v8';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './assets/synth-ui.js',
  './assets/synth-ui.css',
  './assets/pixfix-logo.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png',
  './assets/apple-touch-icon.png',
  './assets/favicon-32.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      // addAll fails the whole install if one file 404s; add individually and shrug off misses
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  // The app document: a navigation, the root, or index.html.
  const isDoc = req.mode === 'navigate'
    || (sameOrigin && (url.pathname === '/' || url.pathname === '/index.html' || url.pathname.endsWith('/index.html')));

  if (isDoc) {
    // NETWORK-FIRST for the HTML: always try the freshest app, refresh the cached
    // copy, and fall back to cache only when offline. This is the update-on-reload
    // behaviour — a new Vercel deploy shows up on the next reload.
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => { c.put('./index.html', copy).catch(() => {}); }).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }

  if (sameOrigin || isFont) {
    // cache-first for the rest of the shell + fonts (versioned by CACHE) — survives offline
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => hit))
    );
  }
  // everything else (YouTube video + thumbnails) falls through to the network untouched
});
