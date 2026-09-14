import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.use({ serviceWorkers: "block" });
test.beforeEach(async ({ context }) => {
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    return ["localhost", "127.0.0.1"].includes(url.hostname) && !url.pathname.startsWith("/api/companion-") ? route.continue() : route.abort();
  });
});

async function audit(page, testInfo, label) {
  await page.evaluate(() => document.fonts.ready);
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  await testInfo.attach(`${label}-axe`, { body: JSON.stringify({ violations: result.violations, incomplete: result.incomplete }, null, 2), contentType: "application/json" });
  expect(result.violations.map(item => ({ rule: item.id, impact: item.impact, targets: item.nodes.map(node => node.target) }))).toEqual([]);
}

for (const path of ["/", "/login", "/signup", "/forgot-password", "/privacy", "/demo"]) {
  test(`automatic WCAG checks ${path}`, async ({ page }, testInfo) => {
    await page.goto(path);
    await expect(page.locator("h1").first()).toBeVisible();
    await audit(page, testInfo, path.replaceAll("/", "-") || "home");
  });
}

async function demo(page) {
  let consent = false;
  await page.route("**/api/capabilities", route => route.fulfill({ json: {
    runtime: "cloudflare", mode: consent ? "demo" : "anonymous",
    capabilities: { chat: consent, speech: consent, transcription: consent, voiceCall: consent, videoCall: consent, memoryRetrieval: consent, imageUpload: false, imageGeneration: false, imageUnderstanding: false, journalReflection: false, scheduledNotifications: false, billing: false },
    voice: { name: "Priya", customization: false },
  } }));
  await page.route("**/api/demo/session", route => { consent = route.request().method() === "POST"; return route.fulfill({ json: { mode: consent ? "demo" : "anonymous" } }); });
  await page.goto("/demo");
  await expect(page.getByRole("checkbox").first()).toBeVisible();
  for (const checkbox of await page.getByRole("checkbox").all()) await checkbox.check();
  await page.getByRole("button", { name: "Meet Mira", exact: true }).click();
  await expect(page.locator(".app-frame")).toBeVisible();
}

test("chat, profile and memory dialog automatic checks", async ({ page }, testInfo) => {
  await demo(page);
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await audit(page, testInfo, "chat");
  await page.getByRole("button", { name: "You", exact: true }).click();
  await audit(page, testInfo, "profile");
  await page.getByRole("button", { name: "Inspect 0 memories", exact: true }).click();
  await page.getByRole("button", { name: "Add memory", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Add a memory" })).toBeVisible();
  await audit(page, testInfo, "memory-dialog");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("narrow reflow and reduced motion retain readable controls", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await demo(page);
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("textbox", { name: "Message Mira", exact: true }).focus();
  await expect(page.getByRole("textbox", { name: "Message Mira", exact: true })).toBeFocused();
  await audit(page, testInfo, "narrow-chat");
  // Double actual computed sizes: changing only the root font size would leave
  // this application's pixel-sized text unchanged and give a false zoom pass.
  await page.evaluate(() => {
    const sizes = [...document.querySelectorAll("body, body *")].filter(element => element instanceof HTMLElement).map(element => [element, parseFloat(getComputedStyle(element).fontSize)]);
    for (const [element, size] of sizes) element.style.setProperty("font-size", `${size * 2}px`, "important");
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole("textbox", { name: "Message Mira", exact: true })).toBeVisible();
});

for (const kind of ["voice", "video"]) {
  test(`${kind} call permission-error controls remain accessible`, async ({ page }, testInfo) => {
    // Permission rejection is synthetic; this audits controls, not acoustics.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
        getUserMedia: async () => { throw new DOMException("Synthetic permission denied", "NotAllowedError"); },
      } });
      window.SpeechRecognition = undefined;
      window.webkitSpeechRecognition = undefined;
    });
    await demo(page);
    await page.getByRole("button", { name: "Chat", exact: true }).click();
    const start = page.getByRole("button", { name: `Start ${kind} call with Mira`, exact: true });
    // Safari deliberately does not focus buttons on mouse clicks. This is a
    // keyboard-return test, so activate from an actual focused control.
    await start.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: `${kind === "voice" ? "Voice" : "Video"} call with Mira`, exact: true })).toBeVisible();
    await audit(page, testInfo, `${kind}-permission-error`);
    await page.keyboard.press("Escape");
    await expect(start).toBeFocused();
  });
}

for (const view of ["Home", "Moments", "Wardrobe"]) {
  test(`${view} view automatic checks`, async ({ page }, testInfo) => {
    await demo(page);
    await page.getByRole("button", { name: view, exact: true }).click();
    await audit(page, testInfo, view.toLowerCase());
  });
}

test("keyboard can skip navigation and return from a dialog", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#welcome")).toBeFocused();
  await demo(page);
  await page.getByRole("link", { name: "Skip to main content", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#app-content")).toBeFocused();
});
