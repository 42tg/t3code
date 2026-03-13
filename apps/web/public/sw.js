/// <reference lib="webworker" />

// Minimal service worker — required for the browser PWA install prompt.
// T3 Code is a live WebSocket app, so we use a network-first strategy
// and only cache the app shell for faster repeat loads.

const CACHE_NAME = "t3code-v1";

// Cache the app shell on install
self.addEventListener("install", () => {
  // Activate immediately — don't wait for existing tabs to close.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Claim all open tabs so the SW is active immediately.
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))),
      )
      .then(() => self.clients.claim()),
  );
});

// Network-first with cache fallback for navigation requests (app shell).
// All other requests (API, WS) go straight to network.
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only cache navigation requests (HTML pages)
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request)),
    );
    return;
  }

  // Cache static assets (JS, CSS, images) with stale-while-revalidate
  if (
    request.destination === "script" ||
    request.destination === "style" ||
    request.destination === "image" ||
    request.destination === "font"
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            return response;
          }),
      ),
    );
    return;
  }

  // Everything else (WebSocket upgrades, API calls) — network only
});
