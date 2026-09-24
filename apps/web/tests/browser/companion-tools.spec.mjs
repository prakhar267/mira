import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
async function auditFeature(page, selector) {
  const result = await new AxeBuilder({ page })
    .include(selector)
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    result.violations.map((item) => ({
      id: item.id,
      targets: item.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
}

import { initialState } from "../../lib/state.ts";
test.use({ serviceWorkers: "block" });
async function prepare(page, context, view) {
  await context.addCookies([
    {
      name: "__Host-companaro_session",
      value: "synthetic-session-only",
      domain: "127.0.0.1",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);
  await page.route(
    (url) => url.pathname === "/app",
    async (route) => {
      const response = await route.fetch({
        headers: {
          ...route.request().headers(),
          cookie: "__Host-companaro_session=synthetic-session-only",
        },
      });
      return route.fulfill({ response });
    },
  );
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.origin === "http://127.0.0.1:4397" ||
      ["data:", "blob:"].includes(url.protocol)
      ? route.continue()
      : route.abort();
  });
  let state = structuredClone(initialState),
    revision = 1;
  state.onboardingComplete = true;
  state.firstMeetingComplete = true;
  state.currentView = view;
  state.messages = [];
  state.memories = [];
  state.calls = [];
  state.journalReflections = [];
  state.journalEntries = [
    {
      id: "journal-one",
      userId: state.user.id,
      title: "My drawing",
      content: "I finished a drawing today.",
      mood: "calm",
      tags: [],
      reflected: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "journal-two",
      userId: state.user.id,
      title: "Another private entry",
      content: "Do not include this unless selected.",
      mood: "thoughtful",
      tags: [],
      reflected: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];
  state.futureEvents = [
    {
      id: "plan-one",
      userId: state.user.id,
      companionId: state.companion.id,
      description: "Synthetic meeting",
      eventDate: new Date(Date.now() + 86400000).toISOString(),
      status: "confirmed",
      createdAt: new Date().toISOString(),
    },
  ];
  await page.route("**/api/capabilities", (route) =>
    route.fulfill({
      json: {
        runtime: "cloudflare",
        mode: "account",
        capabilities: {
          chat: true,
          speech: true,
          transcription: true,
          voiceCall: true,
          videoCall: true,
          memoryRetrieval: true,
          journalReflection: true,
          scheduledNotifications: true,
          billing: false,
        },
        voice: { name: state.companion.voiceId, customization: true },
      },
    }),
  );
  await page.route("**/api/account/state", (route) => {
    if (route.request().method() === "PUT") {
      state = route.request().postDataJSON().state;
      revision++;
    }
    return route.fulfill({
      json: {
        state,
        revision,
        account: { id: state.user.id, name: "Synthetic adult" },
        policy: { termsVersion: "2026-09-13" },
      },
    });
  });
  await page.route("**/api/companion-*", (route) => route.abort());
  await page.goto("/app");
  await expect(page.locator(".app-frame")).toBeVisible();
  return { state: () => state };
}
test("search retrieves an older match, opens surrounding messages and fits mobile", async ({
  page,
  context,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/account/search?**", (route) =>
    route.fulfill({
      json: {
        messages: [
          {
            id: "old",
            conversationId: "old-conversation",
            role: "user",
            content: "My visit to Pune was lovely.",
            createdAt: "2026-09-01T12:00:00Z",
          },
        ],
      },
    }),
  );
  await prepare(page, context, "chat");
  await page
    .getByRole("button", { name: "Search conversations", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Search conversations" });
  await dialog.getByLabel("Search text", { exact: true }).fill("Pune");
  await dialog.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    dialog.getByText("1 matching messages", { exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Read surrounding messages" })
    .click();
  await expect(
    dialog.getByRole("region", { name: "Conversation context" }),
  ).toContainText("My visit to Pune was lovely.");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await auditFeature(page, "dialog");
  await page.screenshot({
    path: testInfo.outputPath("search-mobile.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});
test("voice previews are separate from synthesis and selection persists", async ({
  page,
  context,
}, testInfo) => {
  let previews = 0;
  await page.addInitScript(() => {
    window.Audio = class {
      paused = true;
      play() {
        this.paused = false;
        return Promise.resolve();
      }
      pause() {
        this.paused = true;
      }
      removeAttribute() {}
    };
  });
  await page.route("**/api/voices", (route) =>
    route.fulfill({
      json: {
        voices: [
          {
            id: "Priya",
            name: "Priya",
            language: "hi-IN",
            description: "Warm conversational voice",
          },
          {
            id: "Ashley",
            name: "Ashley",
            language: "en-US",
            description: "Clear conversational voice",
          },
        ],
        selected: "Priya",
      },
    }),
  );
  await page.route("**/api/voices/preview?**", (route) => {
    previews++;
    return route.fulfill({
      contentType: "audio/mpeg",
      body: "ID3synthetic-format-only",
    });
  });
  const fixture = await prepare(page, context, "companion");
  await page.getByRole("tab", { name: "Voice", exact: true }).click();
  await page
    .getByRole("button", { name: "Preview Ashley", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Stop Ashley", exact: true }),
  ).toBeVisible();
  expect(previews).toBe(1);
  await page.getByRole("button", { name: "Use Ashley", exact: true }).click();
  await expect.poll(() => fixture.state().companion.voiceId).toBe("Ashley");
  await auditFeature(page, '[aria-label="Voice library"]');
  await page.screenshot({
    path: testInfo.outputPath("voice-picker.png"),
    fullPage: true,
  });
  await page.reload();
  await page.getByRole("tab", { name: "Voice", exact: true }).click();
  await expect(page.locator(".voice-card--selected")).toContainText("Ashley");
});
test("reflection shares only checked entries, recovers from failure, saves and deletes", async ({
  page,
  context,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let attempts = 0;
  await page.route("**/api/journal-reflection", (route) => {
    attempts++;
    expect(route.request().postDataJSON()).toEqual({
      entryIds: ["journal-one"],
      language: "English",
    });
    return attempts === 1
      ? route.fulfill({
          status: 503,
          json: { error: "Synthetic provider unavailable. Please retry." },
        })
      : route.fulfill({
          json: {
            summary:
              "You made time for your drawing. One optional next step: choose another small sketch.",
            entryIds: ["journal-one"],
            language: "English",
          },
        });
  });
  const fixture = await prepare(page, context, "moments");
  await page
    .getByRole("button", { name: "Journal, plans & reminders", exact: true })
    .click();
  await page
    .getByRole("tab", { name: "Weekly reflection", exact: true })
    .click();
  const generate = page.getByRole("button", {
    name: "Generate selected reflection",
    exact: true,
  });
  await expect(generate).toBeDisabled();
  await page.getByRole("checkbox", { name: /My drawing/ }).check();
  await generate.click();
  await expect(page.getByRole("alert")).toContainText(
    "Synthetic provider unavailable",
  );
  expect(fixture.state().journalReflections).toEqual([]);
  await generate.click();
  await expect(
    page.getByRole("heading", { name: "Your reflection · unsaved" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save reflection", exact: true })
    .click();
  await expect.poll(() => fixture.state().journalReflections.length).toBe(1);
  expect(fixture.state().messages).toEqual([]);
  expect(fixture.state().memories).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(await page.locator(".app-main").evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  expect((await page.locator(".weekly-reflection").boundingBox()).x).toBeGreaterThanOrEqual(0);
  await auditFeature(page, ".weekly-reflection");
  await page.screenshot({
    path: testInfo.outputPath("weekly-reflection.png"),
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Journal", exact: true }).click();
  await page
    .getByRole("button", { name: "Delete My drawing", exact: true })
    .click();
  await expect.poll(() => fixture.state().journalReflections.length).toBe(0);
});
test("reminders request permission only on opt-in and can be stopped", async ({
  page,
  context,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const publicKey = "B" + "a".repeat(86);
  let snapshot = { publicKey, devices: [], rules: [] };
  let subscriptions = 0;
  await page.addInitScript((key) => {
    window.__permissionRequests = 0;
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: {
        permission: "default",
        requestPermission: async () => {
          window.__permissionRequests++;
          window.Notification.permission = "granted";
          return "granted";
        },
      },
    });
    Object.defineProperty(window, "PushManager", {
      configurable: true,
      value: function () {},
    });
    let subscription = null;
    const registration = {
      pushManager: {
        getSubscription: async () => subscription,
        subscribe: async () => {
          subscription = {
            endpoint: "https://fcm.googleapis.com/fcm/send/synthetic-browser",
            options: {},
            toJSON: () => ({
              endpoint: "https://fcm.googleapis.com/fcm/send/synthetic-browser",
              keys: { p256dh: key, auth: "a".repeat(22) },
            }),
            unsubscribe: async () => {
              subscription = null;
              return true;
            },
          };
          return subscription;
        },
      },
    };
    const serviceWorker = new EventTarget();
    Object.assign(serviceWorker, {
      register: async () => registration,
      ready: Promise.resolve(registration),
      getRegistration: async () => registration,
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: serviceWorker,
    });
  }, publicKey);
  await page.route("**/api/account/reminders", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      if (body.action === "subscribe") {
        subscriptions++;
        const endpoint = body.subscription.endpoint;
        const id = await page.evaluate(async (endpoint) => {
          const bytes = new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(endpoint),
            ),
          );
          return btoa(String.fromCharCode(...bytes))
            .replaceAll("+", "-")
            .replaceAll("/", "_")
            .replace(/=+$/, "");
        }, endpoint);
        snapshot.devices = [{ id, createdAt: Date.now() }];
      }
      if (body.action === "save")
        snapshot.rules = [
          {
            ...body.rule,
            id: "daily",
            nextAt: Date.now() + 3600000,
            status: "scheduled",
          },
        ];
      if (body.action === "unsubscribe") {
        snapshot.devices = [];
        snapshot.rules = snapshot.rules.map((rule) => ({
          ...rule,
          enabled: false,
          nextAt: null,
          status: "paused",
        }));
      }
    }
    return route.fulfill({ json: snapshot });
  });
  await prepare(page, context, "profile");
  await page
    .getByRole("button", { name: "Manage reminders", exact: true })
    .click();
  expect(await page.evaluate(() => window.__permissionRequests)).toBe(0);
  await page
    .getByRole("button", {
      name: "Enable notifications on this device",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "This device is enabled", exact: true }),
  ).toBeDisabled();
  expect(subscriptions).toBe(1);
  expect(await page.evaluate(() => window.__permissionRequests)).toBe(1);
  await page.getByLabel("Check-in time", { exact: true }).fill("18:30");
  await page
    .getByRole("button", { name: "Save reminder", exact: true })
    .click();
  await expect(page.locator(".reminder-rule")).toContainText("Daily check-in");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(await page.locator(".app-main").evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await auditFeature(page, ".reminder-settings");
  await page.screenshot({
    path: testInfo.outputPath("reminders.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Turn off all reminders", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "All devices disconnected" }),
  ).toBeVisible();
  expect(snapshot.devices).toEqual([]);
  expect(snapshot.rules[0].enabled).toBe(false);
});
