import { afterEach, describe, expect, it, vi } from "vitest";
async function fixture(
  windows: {
    url: string;
    postMessage?: ReturnType<typeof vi.fn>;
    focus?: ReturnType<typeof vi.fn>;
  }[] = [],
) {
  const handlers = new Map<string, (event: Record<string, unknown>) => void>();
  const cache = { put: vi.fn() },
    caches = {
      keys: vi
        .fn()
        .mockResolvedValue([
          "companion-old",
          "companion-static-v2",
          "unrelated",
        ]),
      delete: vi.fn(),
      open: vi.fn().mockResolvedValue(cache),
      match: vi.fn(),
    };
  const self = {
    addEventListener: (
      name: string,
      handler: (event: Record<string, unknown>) => void,
    ) => handlers.set(name, handler),
    skipWaiting: vi.fn(),
    location: { origin: "https://mira.test" },
    registration: { showNotification: vi.fn() },
    clients: {
      claim: vi.fn(),
      matchAll: vi.fn().mockResolvedValue(windows),
      openWindow: vi.fn(),
    },
  };
  const fetcher = vi.fn();
  vi.stubGlobal("self", self);
  vi.stubGlobal("caches", caches);
  vi.stubGlobal("fetch", fetcher);
  vi.resetModules();
  const serviceWorkerPath = "../public/sw.js";
  await import(serviceWorkerPath);
  async function dispatch(name: string, fields = {}) {
    let work: Promise<unknown> | undefined;
    const attach = (promise: Promise<unknown>) => {
      work = promise;
    };
    handlers.get(name)!({ ...fields, waitUntil: attach, respondWith: attach });
    return work;
  }
  return { self, cache, caches, fetcher, dispatch };
}
afterEach(() => vi.unstubAllGlobals());
describe("service worker lifecycle and privacy", () => {
  it("activates immediately and removes only obsolete app caches", async () => {
    const f = await fixture();
    await f.dispatch("install");
    await f.dispatch("activate");
    expect(f.self.skipWaiting).toHaveBeenCalledOnce();
    expect(f.caches.delete).toHaveBeenCalledExactlyOnceWith("companion-old");
    expect(f.self.clients.claim).toHaveBeenCalledOnce();
  });
  it.each([
    { method: "POST" },
    { url: "https://external.test/image.png" },
    { url: "https://mira.test/api/account" },
    { destination: "document" },
  ])(
    "does not cache private/API/cross-origin requests: %j",
    async (override) => {
      const f = await fixture();
      await f.dispatch("fetch", {
        request: {
          method: "GET",
          destination: "image",
          url: "https://mira.test/icon.png",
          ...override,
        },
      });
      expect(f.fetcher).not.toHaveBeenCalled();
      expect(f.caches.open).not.toHaveBeenCalled();
    },
  );
  it("caches successful static responses, falls back offline and propagates a cache miss", async () => {
    const f = await fixture();
    const request = {
      method: "GET",
      destination: "image",
      url: "https://mira.test/icon.png",
    };
    f.fetcher.mockResolvedValueOnce(new Response("image"));
    const response = (await f.dispatch("fetch", { request })) as Response;
    expect(await response.text()).toBe("image");
    expect(f.cache.put).toHaveBeenCalledOnce();
    f.fetcher.mockRejectedValue(new Error("offline"));
    f.caches.match.mockResolvedValueOnce(new Response("cached"));
    expect(
      await ((await f.dispatch("fetch", { request })) as Response).text(),
    ).toBe("cached");
    await expect(f.dispatch("fetch", { request })).rejects.toThrow("offline");
  });
  it.each([false, true])(
    "never caches errors or redirected static responses (redirected=%s)",
    async (redirected) => {
      const f = await fixture();
      const response = new Response("bad", { status: redirected ? 200 : 404 });
      Object.defineProperty(response, "redirected", { value: redirected });
      f.fetcher.mockResolvedValue(response);
      await f.dispatch("fetch", {
        request: {
          method: "GET",
          destination: "script",
          url: "https://mira.test/app.js",
        },
      });
      expect(f.cache.put).not.toHaveBeenCalled();
    },
  );
  it("constrains notification content and handles missing/malformed payloads", async () => {
    const f = await fixture();
    await f.dispatch("push", {
      data: {
        json: () => ({
          title: "Your check-in reminder",
          tag: "x".repeat(100),
          body: "private",
          url: "https://evil.test",
        }),
      },
    });
    expect(f.self.registration.showNotification).toHaveBeenLastCalledWith(
      "Your check-in reminder",
      expect.objectContaining({
        body: "Open Mira when it suits you.",
        tag: "x".repeat(80),
        data: { url: "/app?view=activities&tab=reminders" },
      }),
    );
    await f.dispatch("push");
    await f.dispatch("push", { data: { json: () => null } });
    await f.dispatch("push", {
      data: {
        json: () => {
          throw new Error("bad json");
        },
      },
    });
    expect(f.self.registration.showNotification).toHaveBeenLastCalledWith(
      "Your saved-plan reminder",
      expect.objectContaining({ tag: "mira-reminder" }),
    );
  });
  it("focuses only a same-origin app tab or opens the fixed destination", async () => {
    const app = {
      url: "https://mira.test/app",
      postMessage: vi.fn(),
      focus: vi.fn(),
    };
    const f = await fixture([
      { url: "https://evil.test/app" },
      { url: "https://mira.test/login" },
      app,
    ]);
    const close = vi.fn();
    await f.dispatch("notificationclick", { notification: { close } });
    expect(close).toHaveBeenCalledOnce();
    expect(app.focus).toHaveBeenCalledOnce();
    expect(app.postMessage).toHaveBeenCalledWith({
      type: "mira-open-reminders",
    });
    const empty = await fixture();
    await empty.dispatch("notificationclick", { notification: { close } });
    expect(empty.self.clients.openWindow).toHaveBeenCalledWith(
      "https://mira.test/app?view=activities&tab=reminders",
    );
  });
});
