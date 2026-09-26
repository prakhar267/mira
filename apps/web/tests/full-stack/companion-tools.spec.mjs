import { test, expect } from "@playwright/test";
import { initialState } from "../../lib/state.ts";
import { randomUUID, webcrypto } from "node:crypto";
const origin = "https://127.0.0.1:4398";
test("real account → search → reflection → voice → reminders → persistence and cleanup", async ({
  page,
  context,
}) => {
  const request = context.request;
  const state = structuredClone(initialState);
  Object.assign(state, {
    onboardingComplete: true,
    firstMeetingComplete: true,
    currentView: "chat",
    messages: [],
    memories: [],
    calls: [],
    journalReflections: [],
  });
  state.user.adultConfirmed = true;
  state.messages = Array.from({ length: 250 }, (_, i) => ({
    id: `e2e-${i}`,
    conversationId: state.activeConversationId,
    role: "user",
    content:
      i === 0 ? "My old discussion about Pune" : "Synthetic conversation",
    createdAt: new Date(1700000000000 + i * 1000).toISOString(),
    status: "sent",
  }));
  state.journalEntries = ["selected", "private"].map((id) => ({
    id,
    userId: state.user.id,
    title: id === "selected" ? "My sketch" : "Unselected private journal",
    content:
      id === "selected" ? "I finished a drawing." : "Excluded from reflection.",
    mood: "calm",
    tags: [],
    reflected: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
  state.futureEvents = [
    {
      id: "plan",
      userId: state.user.id,
      companionId: state.companion.id,
      description: "Synthetic plan",
      eventDate: new Date(Date.now() + 86400000).toISOString(),
      status: "confirmed",
      createdAt: new Date().toISOString(),
    },
  ];
  const signup = await request.post(`${origin}/api/account/signup`, {
    headers: { origin },
    data: {
      email: `full-stack-${randomUUID()}@example.test`,
      password: "Synthetic-E2E-password1!",
      name: "Synthetic QA",
      state,
      policy: {
        termsVersion: "2026-09-13",
        adultConfirmed: true,
        aiProcessingConsent: true,
      },
    },
  });
  expect(signup.status(), await signup.text()).toBe(201);
  const cookie = signup.headers()["set-cookie"].split(";")[0];
  // HTTPS preserves the real server-issued Secure cookie; no API responses or
  // authentication headers are replaced by this test.
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.origin === origin
      ? route.continue()
      : ["blob:", "data:"].includes(url.protocol)
        ? route.continue()
        : route.abort();
  });
  const api = async (path) => {
    const result = await request.get(origin + path, { headers: { cookie } });
    expect(result.status(), await result.text()).toBe(200);
    return result.json();
  };
  const pushKey = await webcrypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const keys = {
    p256dh: Buffer.from(
      await webcrypto.subtle.exportKey("raw", pushKey.publicKey),
    ).toString("base64url"),
    auth: Buffer.alloc(16, 1).toString("base64url"),
  };
  await page.addInitScript(
    ({ keys }) => {
      // Hardware/provider boundaries are synthetic; app routes and storage are real.
      window.Audio = class {
        play() {
          return Promise.resolve();
        }
        pause() {}
        removeAttribute() {}
      };
      let subscription = null;
      window.__permissionRequests = 0;
      Object.defineProperty(window, "Notification", {
        configurable: true,
        value: {
          permission: "default",
          requestPermission: async () => {
            window.__permissionRequests++;
            return "granted";
          },
        },
      });
      Object.defineProperty(window, "PushManager", {
        configurable: true,
        value: function () {},
      });
      const registration = {
        pushManager: {
          getSubscription: async () => subscription,
          subscribe: async () => {
            subscription = {
              endpoint:
                "https://fcm.googleapis.com/fcm/send/full-stack-synthetic",
              options: {},
              toJSON: () => ({
                endpoint:
                  "https://fcm.googleapis.com/fcm/send/full-stack-synthetic",
                keys,
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
    },
    { keys },
  );
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  await page.goto("/app");
  await expect(page.locator(".app-frame")).toBeVisible();
  expect(
    (await api("/api/account/state")).state.messages.some(
      (m) => m.id === "e2e-0",
    ),
  ).toBe(false);
  await page
    .getByRole("button", { name: "Search conversations", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Search conversations" });
  await dialog.getByLabel("Search text", { exact: true }).fill("Pune");
  await dialog.getByRole("button", { name: "Search", exact: true }).click();
  await expect(dialog).toContainText("1 matching messages");
  await dialog
    .getByRole("button", { name: "Read surrounding messages" })
    .click();
  await expect(
    dialog.getByRole("region", { name: "Conversation context" }),
  ).toContainText("My old discussion about Pune");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Moments", exact: true }).click();
  await page
    .getByRole("button", { name: "Journal, plans & reminders", exact: true })
    .click();
  await page
    .getByRole("tab", { name: "Weekly reflection", exact: true })
    .click();
  await page.getByRole("checkbox", { name: /My sketch/ }).check();
  await page
    .getByRole("button", { name: "Generate selected reflection", exact: true })
    .click();
  await expect(page.locator(".reflection-output")).toContainText(
    "I finished a drawing.",
  );
  await expect(page.locator(".reflection-output")).not.toContainText(
    "Unselected private",
  );
  await page
    .getByRole("button", { name: "Save reflection", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await api("/api/account/state")).state.journalReflections.length,
    )
    .toBe(1);
  await page.getByRole("button", { name: "Wardrobe", exact: true }).click();
  await page.getByRole("tab", { name: "Voice", exact: true }).click();
  const previewResponse = page.waitForResponse((r) =>
    r.url().includes("/api/voices/preview?"),
  );
  await page
    .getByRole("button", { name: "Preview Ashley", exact: true })
    .click();
  expect((await previewResponse).status()).toBe(200);
  await page.getByRole("button", { name: "Use Ashley", exact: true }).click();
  await expect
    .poll(async () => (await api("/api/account/state")).state.companion.voiceId)
    .toBe("Ashley");
  await page.reload();
  await page.getByRole("tab", { name: "Voice", exact: true }).click();
  await expect(page.locator(".voice-card--selected")).toContainText("Ashley");
  await page.goto("/app?view=activities&tab=reminders");
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
  expect((await api("/api/account/reminders")).devices).toHaveLength(1);
  await page.getByLabel("Time zone", { exact: true }).fill("UTC");
  await page.getByLabel("Check-in time", { exact: true }).fill("18:30");
  await page
    .getByRole("button", { name: "Save reminder", exact: true })
    .click();
  await expect(page.locator(".reminder-rule")).toContainText("Daily check-in");
  expect((await api("/api/account/reminders")).rules[0]).toMatchObject({
    enabled: true,
    time: "18:30",
    timezone: "UTC",
  });
  await page
    .getByRole("button", { name: "Turn off all reminders", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "All devices disconnected" }),
  ).toBeVisible();
  expect((await api("/api/account/reminders")).devices).toEqual([]);
  await page.getByRole("tab", { name: "Journal", exact: true }).click();
  await page
    .getByRole("button", { name: "Delete My sketch", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await api("/api/account/state")).state.journalReflections.length,
    )
    .toBe(0);
  expect((await api("/api/account/state")).state.memories).toEqual([]);
  expect(failures).toEqual([]);
  const reauth = await request.post(`${origin}/api/account/reauth`, {
    headers: { origin },
    data: { password: "Synthetic-E2E-password1!" },
  });
  expect(reauth.status()).toBe(200);
  const deleted = await request.delete(`${origin}/api/account/delete`, {
    headers: { origin },
  });
  expect(deleted.status()).toBe(200);
  expect(await deleted.json()).toMatchObject({ deleted: true });
  expect(
    (await request.get(`${origin}/api/account/search?q=Pune`, { headers: { cookie } })).status(),
  ).toBe(401);
});
