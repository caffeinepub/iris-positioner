const CACHE_NAME = 'iris-positioner-v3';

// Precache the app shell on install
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll([
        '/',
        '/manifest.json',
        '/assets/generated/iris-icon.dim_512x512.png',
      ])
    )
  );
  self.skipWaiting();
});

// Clean up old caches on activate
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Skip cross-origin requests (e.g. ICP canister calls)
  if (url.origin !== self.location.origin) return;

  // For navigation requests: cache-first with network fallback
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.match('/').then((cached) => {
        if (cached) {
          // Return cached version immediately, refresh in background
          fetch(event.request)
            .then((response) => {
              if (response.ok) {
                caches.open(CACHE_NAME).then((cache) =>
                  cache.put('/', response)
                );
              }
            })
            .catch(() => {});
          return cached;
        }
        return fetch(event.request).catch(
          () => caches.match('/')
        );
      })
    );
    return;
  }

  // For all other assets: cache-first, update in background (stale-while-revalidate)
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) =>
              cache.put(event.request, clone)
            );
          }
          return response;
        })
        .catch(() => null);

      return cached || networkFetch;
    })
  );
});
