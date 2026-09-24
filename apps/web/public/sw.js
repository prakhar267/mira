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


self.addEventListener("push", event => {
  let data = {};
  try { data = event.data?.json() ?? {}; } catch { /* Show the generic fallback. */ }
  const title = data.title === "Your check-in reminder" ? data.title : "Your saved-plan reminder";
  event.waitUntil(self.registration.showNotification(title, {
    body: "Open Mira when it suits you.", icon: "/icon.png", badge: "/icon.png",
    tag: typeof data.tag === "string" ? data.tag.slice(0,80) : "mira-reminder",
    data: { url: "/app?view=activities&tab=reminders" },
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const url = new URL("/app?view=activities&tab=reminders", self.location.origin).href;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin && new URL(client.url).pathname === "/app");
    if (existing) { existing.postMessage({ type: "mira-open-reminders" }); await existing.focus(); }
    else await self.clients.openWindow(url);
  })());
});
