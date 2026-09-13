import { test, expect } from "@playwright/test";

// UI-adapter tests only: all audio/AI and permissions below are synthetic.
// These scenarios deliberately do not certify microphone or acoustic quality.
// Compiled production pages register a service worker; WebKit may bypass
// page.route for controlled requests. This fixture suite does not test the SW.
test.use({ serviceWorkers: "block" });
test.beforeEach(async ({ context }) => {
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/api/companion-")) return route.abort("blockedbyclient");
    return ["127.0.0.1", "localhost"].includes(url.hostname) || ["data:", "blob:"].includes(url.protocol) ? route.continue() : route.abort();
  });
});

async function enterDemo(page) {
  let session = false;
  await page.route("**/api/capabilities", route => route.fulfill({ json: {
    runtime: "cloudflare", mode: session ? "demo" : "anonymous", policyVersion: "2026-09-13",
    capabilities: { chat: session, speech: session, transcription: session, voiceCall: session, videoCall: session, memoryRetrieval: session, imageUpload: false, imageGeneration: false, imageUnderstanding: false, journalReflection: false, scheduledNotifications: false, billing: false },
    voice: { name: "Priya", customization: false },
  } }));
  await page.route("**/api/demo/session", async route => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toMatchObject({ adultDeclared: true, aiProcessingConsent: true, policyVersion: "2026-09-13" }); session = true;
    } else session = false;
    await route.fulfill({ json: { mode: session ? "demo" : "anonymous" } });
  });
  await page.goto("/demo");
  const meet = page.getByRole("button", { name: "Meet Mira", exact: true });
  await expect(meet).toBeDisabled();
  await page.getByRole("checkbox").nth(0).check();
  await expect(meet).toBeDisabled();
  await page.getByRole("checkbox").nth(1).check();
  await page.getByRole("checkbox").nth(2).check();
  await expect(meet).toBeEnabled(); await meet.click();
  await expect(page.locator(".app-frame")).toBeVisible();
  expect(session).toBe(true); // Fail explicitly if session requests escaped the fixture.
}
async function navigate(page, name) { await page.getByRole("button", { name, exact: true }).click(); }

test("failed chat stays a failed turn and explicit retry does not duplicate it", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/companion-chat", route => {
    attempts++;
    return attempts === 1 ? route.fulfill({ status: 503, json: { error: "Synthetic provider unavailable. Retry your message.", code: "SERVICE_UNAVAILABLE", requestId: "test-chat" } }) : route.fulfill({ json: { reply: "Your meeting is Sunday morning. Got it.", model: "synthetic" } });
  });
  await enterDemo(page); await navigate(page, "Chat");
  await page.getByRole("textbox", { name: "Message Mira", exact: true }).fill("My meeting is Sunday morning.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "That didn’t work" })).toBeVisible();
  await page.getByRole("button", { name: "Okay", exact: true }).click();
  await expect(page.locator(".message--assistant")).toHaveCount(0);
  await page.getByRole("button", { name: "Retry last message", exact: true }).click();
  await expect(page.locator(".message--assistant")).toContainText("Your meeting is Sunday morning.");
  await expect(page.locator(".message--user")).toHaveCount(1);
  expect(attempts).toBe(2);
  await page.getByRole("button", { name: "Conversation tools", exact: true }).click();
  await expect(page.getByRole("button", { name: "Share a photo · unavailable", exact: true })).toBeDisabled();
});

test("memory remains inspectable while paused and forgetting removes its contents", async ({ page }) => {
  await enterDemo(page); await navigate(page, "You");
  await page.getByRole("button", { name: "Inspect 0 memories", exact: true }).click();
  await page.getByRole("button", { name: "Add memory", exact: true }).click();
  const add = page.getByRole("dialog", { name: "Add a memory", exact: true });
  await add.getByRole("textbox").fill("My synthetic test plant is named Cedar.");
  await add.getByRole("button", { name: "Add memory", exact: true }).click();
  await expect(page.locator(".memory-row")).toContainText("Cedar");
  await page.getByRole("button", { name: "Edit memory", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Correct this memory", exact: true });
  await edit.getByRole("textbox").fill("My synthetic test plant is named Maple.");
  await edit.getByRole("button", { name: "Save correction", exact: true }).click();
  await page.getByRole("button", { name: "Pause memory", exact: true }).click();
  await expect(page.locator(".memory-row")).toContainText("Maple");
  await page.getByRole("button", { name: "Delete memory", exact: true }).click();
  await expect(page.locator(".memory-row")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("mira-demo-v1"))).not.toContain("Maple");
});

async function syntheticMedia(page, { delayPermission = false } = {}) {
  await page.route("**/api/companion-speech", route => route.fulfill({ contentType: "audio/wav", body: Buffer.from("synthetic-audio-fixture") }));
  await page.addInitScript(({ delayPermission }) => {
    window.__mediaTest = { requested: 0, stopped: 0, paused: 0, resolve: null };
    const stats = window.__mediaTest;
    const track = () => ({ stop() { stats.stopped++; } });
    const getUserMedia = async () => { stats.requested++; if (delayPermission) await new Promise(resolve => { stats.resolve = resolve; }); return { getTracks: () => [track()] }; };
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    window.Audio = class {
      currentTime = 0; duration = 0.05; paused = false;
      async play() { queueMicrotask(() => this.onplaying?.()); setTimeout(() => { if (!this.paused) this.onended?.(); }, 40); }
      pause() { this.paused = true; stats.paused++; }
    };
    window.OfflineAudioContext = undefined;
    window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined;
    window.MediaRecorder = class {
      static isTypeSupported() { return true; }
      state = "inactive"; mimeType = "audio/webm";
      start() { this.state = "recording"; }
      stop() { this.state = "inactive"; queueMicrotask(() => this.onstop?.()); }
    };
    window.AudioContext = class {
      async resume() {} async close() {}
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
      createAnalyser() { return { fftSize: 512, disconnect() {}, getFloatTimeDomainData(samples) { samples.fill(0); } }; }
    };
  }, { delayPermission });
}

for (const kind of ["voice", "video"]) {
  test(`${kind} call releases microphone and restores keyboard focus after hang-up`, async ({ page }) => {
    await syntheticMedia(page); await enterDemo(page); await navigate(page, "Chat");
    const start = page.getByRole("button", { name: `Start ${kind} call with Mira`, exact: true });
    await start.focus(); await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: `${kind === "voice" ? "Voice" : "Video"} call with Mira`, exact: true });
    await expect(dialog).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__mediaTest.requested)).toBe(1);
    await expect(dialog.getByRole("button", { name: /Listening automatically/ })).toBeVisible();
    if (kind === "video") await expect(dialog.getByRole("button", { name: "Frame understanding unavailable" })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__mediaTest.stopped)).toBeGreaterThan(0);
    await expect(start).toBeFocused();
  });
  test(`${kind} call fences a microphone permission result arriving after hang-up`, async ({ page }) => {
    await syntheticMedia(page, { delayPermission: true }); await enterDemo(page); await navigate(page, "Chat");
    await page.getByRole("button", { name: `Start ${kind} call with Mira`, exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__mediaTest.requested)).toBe(1);
    await page.getByRole("button", { name: kind === "voice" ? "End call" : "End video call", exact: true }).click();
    await page.evaluate(() => window.__mediaTest.resolve());
    await expect.poll(() => page.evaluate(() => window.__mediaTest.stopped)).toBeGreaterThan(0);
    await expect(page.locator(".live-call")).toHaveCount(0);
    expect(await page.evaluate(() => window.__mediaTest.requested)).toBe(1);
  });
}
