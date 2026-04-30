// ============================================================
//  service-worker.js  —  Patient Care Checklist PWA
//  Caches app shell for offline/standalone use.
//  Data always comes live from Supabase when online.
// ============================================================

const CACHE_NAME = 'rehab-checklist-v1';

// Files that make up the app shell (UI only — data stays in Supabase)
const APP_SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/config.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

// ── Install: cache the app shell ─────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Cache each file individually so one failure doesn't block all
      return Promise.allSettled(
        APP_SHELL.map(url => cache.add(url).catch(() => {}))
      );
    })
  );
  self.skipWaiting();
});

// ── Activate: remove old caches ───────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch: serve from cache, fall back to network ─────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Always go to network for Supabase API calls (live data)
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // For everything else: cache-first, then network
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Cache valid responses for future offline use
        if (response && response.status === 200 && response.type !== 'opaque') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // If totally offline and not cached, show index.html as fallback
        return caches.match('/index.html');
      });
    })
  );
});
