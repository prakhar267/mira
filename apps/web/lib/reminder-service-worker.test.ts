import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

function fixture(windows: object[] = []) {
  const handlers = new Map<string, (event: Record<string, unknown>) => void>();
  const showNotification = vi.fn(async () => undefined);
  const openWindow = vi.fn(async () => undefined);
  const self = {
    addEventListener: (
      name: string,
      handler: (event: Record<string, unknown>) => void,
    ) => handlers.set(name, handler),
    location: { origin: "https://mira.example" },
    registration: { showNotification },
    clients: { matchAll: async () => windows, openWindow },
  };
  runInNewContext(
    readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"),
    { self, URL, Set },
  );
  async function dispatch(name: string, payload: Record<string, unknown>) {
    let pending: Promise<unknown> | undefined;
    handlers.get(name)!({
      ...payload,
      waitUntil: (work: Promise<unknown>) => {
        pending = work;
      },
    });
    await pending;
  }
  return { dispatch, showNotification, openWindow };
}

describe("reminder service worker", () => {
  it("shows only generic copy and ignores incoming private text and navigation", async () => {
    const { dispatch, showNotification } = fixture();
    await dispatch("push", {
      data: {
        json: () => ({
          title: "private title",
          body: "private journal",
          url: "https://untrusted.example",
          tag: "safe-tag",
        }),
      },
    });
    expect(showNotification).toHaveBeenCalledWith(
      "Your saved-plan reminder",
      expect.objectContaining({
        body: "Open Mira when it suits you.",
        tag: "safe-tag",
        data: { url: "/app?view=activities&tab=reminders" },
      }),
    );
    await dispatch("push", {
      data: {
        json: () => {
          throw new Error("malformed");
        },
      },
    });
    expect(showNotification).toHaveBeenCalledTimes(2);
  });
  it("focuses an existing app or opens the fixed reminder destination", async () => {
    const existing = {
      url: "https://mira.example/app",
      postMessage: vi.fn(),
      focus: vi.fn(async () => undefined),
    };
    const current = fixture([existing]);
    const close = vi.fn();
    await current.dispatch("notificationclick", { notification: { close } });
    expect(close).toHaveBeenCalled();
    expect(existing.postMessage).toHaveBeenCalledWith({
      type: "mira-open-reminders",
    });
    expect(existing.focus).toHaveBeenCalled();
    expect(current.openWindow).not.toHaveBeenCalled();
    const empty = fixture();
    await empty.dispatch("notificationclick", { notification: { close } });
    expect(empty.openWindow).toHaveBeenCalledWith(
      "https://mira.example/app?view=activities&tab=reminders",
    );
  });
});
