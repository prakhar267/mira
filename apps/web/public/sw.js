const CACHE = "companion-static-v2";
const STATIC_DESTINATIONS = new Set(["font", "image", "script", "style", "worker"]);

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith("companion-") && key !== CACHE)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Cross-origin model/voice downloads must pass through untouched. The old
  // catch-all handler converted a failed Hugging Face request into the cached
  // login page, which made the speech worker parse HTML as model JSON.
  if (
    request.method !== "GET"
    || url.origin !== self.location.origin
    || url.pathname.startsWith("/api/")
    || !STATIC_DESTINATIONS.has(request.destination)
  ) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok && !response.redirected) {
        const cache = await caches.open(CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    } catch (cause) {
      const cached = await caches.match(request);
      if (cached) return cached;
      throw cause;
    }
  })());
});
