/**
 * Service Worker: Offline-Shell für die Bühne.
 * Strategie: network-first mit Cache-Fallback — nach dem ersten Besuch
 * startet die App auch ohne Netz (der Host im LAN bleibt natürlich nötig
 * für Live-Daten; API/WS werden nie gecacht).
 */

const CACHE = 'unableset-shell-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api') ||
    url.pathname === '/ws'
  ) {
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const fresh = await fetch(event.request);
        if (fresh.ok) cache.put(event.request, fresh.clone());
        return fresh;
      } catch {
        const cached = await cache.match(event.request, {
          ignoreSearch: url.pathname === '/' || url.pathname === '/index.html',
        });
        return cached ?? Response.error();
      }
    })(),
  );
});
