import { test, expect } from "@playwright/test";
import { coldMobilePage, enterDemo, observeAvatar, observeInteractions, recordInteraction, sampleAvatarCadence, syntheticCallMedia } from "./lab-fixtures.mjs";

const conditions = "Local compiled Worker, fresh Chromium context, 393x851, DPR 1, mobile/touch emulation, cold HTTP cache, 4x CPU throttle, unshaped loopback network; not physical hardware, production transport, field INP, or provider latency.";
const measuredAssets = () => performance.getEntriesByType("resource").filter(entry => new URL(entry.name).origin === location.origin).map(entry => ({
  path: new URL(entry.name).pathname, initiatorType: entry.initiatorType, transferBytes: entry.transferSize,
  encodedBytes: entry.encodedBodySize, decodedBytes: entry.decodedBodySize, durationMs: entry.duration,
}));

test("three cold mobile-emulated app sessions record real interaction timing", async ({ browser }, testInfo) => {
  const samples = [];
  try {
    for (let sample = 1; sample <= 3; sample++) {
      const { context, page, requests } = await coldMobilePage(browser);
      try {
        await observeInteractions(page);
        await enterDemo(page);
        await recordInteraction(page, "open-chat", () => page.getByRole("button", { name: "Chat", exact: true }).tap(),
          () => expect(page.getByRole("textbox", { name: "Message Mira", exact: true })).toBeVisible());
        const message = page.getByRole("textbox", { name: "Message Mira", exact: true });
        await recordInteraction(page, "type-message", async () => { await message.tap(); await message.pressSequentially("My meeting is Sunday morning.", { delay: 25 }); },
          () => expect(message).toHaveValue("My meeting is Sunday morning."));
        await recordInteraction(page, "send-synthetic-message", () => page.getByRole("button", { name: "Send message", exact: true }).tap(),
          () => expect(page.locator(".message--assistant")).toContainText("Your synthetic meeting is Sunday morning."));
        await recordInteraction(page, "open-profile", () => page.getByRole("button", { name: "You", exact: true }).tap(),
          () => expect(page.getByRole("button", { name: /^Inspect \d+ memories$/ })).toBeVisible());
        await recordInteraction(page, "open-memories", () => page.getByRole("button", { name: /^Inspect \d+ memories$/ }).tap(),
          () => expect(page.getByRole("button", { name: "Add memory", exact: true })).toBeVisible());
        await recordInteraction(page, "open-memory-dialog", () => page.getByRole("button", { name: "Add memory", exact: true }).tap(),
          () => expect(page.getByRole("dialog", { name: "Add a memory", exact: true })).toBeVisible());
        await recordInteraction(page, "close-memory-dialog", () => page.keyboard.press("Escape"),
          () => expect(page.getByRole("dialog", { name: "Add a memory", exact: true })).toHaveCount(0));
        const timing = await page.evaluate(() => window.__miraInteractionLab);
        const assets = await page.evaluate(measuredAssets);
        samples.push({ sample, timing, assets, requests: { ...requests }, overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth) });
        expect(timing.supported).toBe(true);
        expect(timing.actions).toHaveLength(7);
        // Ensure genuine browser interactionId evidence exists. We do not
        // require an entry for every fast action below the API's 16ms floor.
        expect(timing.actions.flatMap(action => action.events).length).toBeGreaterThan(0);
        expect(timing.actions.flatMap(action => action.events).every(event => event.interactionId > 0 && event.durationMs >= 16)).toBe(true);
        expect(requests).toMatchObject({ session: 1, chat: 1, speech: 0, unexpected: [] });
        expect(samples.at(-1).overflow).toBe(false);
        // The costly VRM must wait for an explicitly opened video call.
        expect(assets.filter(asset => /\.(?:vrm|glb)$/i.test(asset.path))).toEqual([]);
        if (sample === 1) await page.screenshot({ path: testInfo.outputPath("app-memory-mobile.png") });
      } finally { await context.close(); }
    }
  } finally {
    await testInfo.attach("app-interaction-lab-measurements", { body: JSON.stringify({ measuredAt: new Date().toISOString(), conditions,
      limitations: "Fixed scripted actions with synthetic replies. Event Timing durations are quantized and entries below 16ms are absent. No INP percentile, physical-device acceptance, live latency or before/after improvement claim.", samples }, null, 2), contentType: "application/json" });
  }
});

test("avatar pauses when hidden, resumes once, and falls back after actual WebGL context loss", async ({ browser }) => {
  const { context, page, requests } = await coldMobilePage(browser);
  try {
    await syntheticCallMedia(page);
    await observeAvatar(page);
    await enterDemo(page);
    await page.getByRole("button", { name: "Chat", exact: true }).tap();
    await page.getByRole("button", { name: "Start video call with Mira", exact: true }).tap();
    await expect(page.locator(".live-avatar-3d--ready")).toBeVisible({ timeout: 90_000 });
    const canvas = page.locator(".live-avatar-3d__canvas");
    expect(await canvas.evaluate(element => element.width * element.height)).toBeLessThanOrEqual(601_600);
    // Exercise the visibility listener deterministically without taking over
    // the user's foreground browser or claiming a physical backgrounding test.
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const paused = await page.evaluate(() => window.__miraAvatarLab.drawCalls);
    await page.waitForTimeout(350);
    expect(await page.evaluate(() => window.__miraAvatarLab.drawCalls)).toBe(paused);
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => page.evaluate(() => window.__miraAvatarLab.drawCalls)).toBeGreaterThan(paused);
    await canvas.evaluate(element => {
      const context = element.getContext("webgl2");
      const extension = context?.getExtension("WEBGL_lose_context");
      if (!extension) throw new Error("WebGL loss testing is unavailable");
      extension.loseContext();
    });
    await expect(page.locator(".live-avatar-3d--fallback")).toBeVisible();
    await expect(page.getByText("3D is unavailable on this device · using anime portrait mode", { exact: true })).toBeVisible();
    const lost = await page.evaluate(() => window.__miraAvatarLab.drawCalls);
    await page.waitForTimeout(350);
    expect(await page.evaluate(() => window.__miraAvatarLab.drawCalls)).toBe(lost);
    await page.getByRole("button", { name: "End video call", exact: true }).tap();
    await expect(page.getByRole("dialog", { name: "Video call with Mira", exact: true })).toHaveCount(0);
    expect(requests).toMatchObject({ chat: 0, speech: 1, unexpected: [] });
  } finally { await context.close(); }
});

test("cold video avatar records load, real WebGL activity and frame-timing proxies", async ({ browser }, testInfo) => {
  const { context, page, requests } = await coldMobilePage(browser);
  const evidence = { measuredAt: new Date().toISOString(), conditions,
    limitations: "One local instrumented cold load. Fake playback and silent synthetic microphone; no acoustic, echo, camera, real-device, presented-FPS or perceptual lip-sync certification.", samples: [] };
  try {
    await syntheticCallMedia(page);
    await observeAvatar(page);
    await observeInteractions(page);
    await enterDemo(page);
    await page.getByRole("button", { name: "Chat", exact: true }).tap();
    const before = await page.evaluate(measuredAssets);
    expect(before.filter(asset => /\.(?:vrm|glb)$/i.test(asset.path))).toEqual([]);
    const callStartedAt = await page.evaluate(() => performance.now());
    await recordInteraction(page, "open-video-call", () => page.getByRole("button", { name: "Start video call with Mira", exact: true }).tap(),
      () => expect(page.getByRole("dialog", { name: "Video call with Mira", exact: true })).toBeVisible());
    const dialog = page.getByRole("dialog", { name: "Video call with Mira", exact: true });
    await expect(page.locator(".live-avatar-3d--ready")).toBeVisible({ timeout: 90_000 });
    await expect(page.locator(".video-call__status")).toContainText("Mira is speaking");
    const loaded = await page.evaluate(() => ({ ...window.__miraAvatarLab }));
    evidence.load = { callStartToReadyMs: loaded.readyAt - callStartedAt, callStartToFirstDrawMs: loaded.firstDrawAt - callStartedAt, ...loaded };
    evidence.samples.push(await sampleAvatarCadence(page, "synthetic-speaking"));
    await page.screenshot({ path: testInfo.outputPath("avatar-speaking-mobile.png") });
    await page.evaluate(() => window.__miraLabMedia.activeAudio.finish());
    await expect(dialog.getByRole("button", { name: "Listening automatically", exact: true })).toBeVisible();
    evidence.samples.push(await sampleAvatarCadence(page, "synthetic-listening"));
    await recordInteraction(page, "hide-call-captions", () => dialog.getByRole("button", { name: "Hide captions", exact: true }).tap(),
      () => expect(page.locator(".video-call__captions")).toHaveCount(0));
    await page.screenshot({ path: testInfo.outputPath("avatar-mobile-ready.png") });
    await recordInteraction(page, "open-call-activity", () => dialog.getByRole("button", { name: "Activity", exact: true }).tap(),
      () => expect(page.locator(".call-activity-menu")).toBeVisible());
    await recordInteraction(page, "end-video-call", () => dialog.getByRole("button", { name: "End video call", exact: true }).tap(),
      () => expect(dialog).toHaveCount(0));
    await expect.poll(() => page.evaluate(() => window.__miraLabMedia.stopped)).toBeGreaterThan(0);
    const drawsAfterUnmount = await page.evaluate(() => window.__miraAvatarLab.drawCalls);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.__miraAvatarLab.drawCalls)).toBe(drawsAfterUnmount);
    evidence.assets = await page.evaluate(measuredAssets);
    evidence.final = await page.evaluate(() => ({ avatar: window.__miraAvatarLab, media: {
      requested: window.__miraLabMedia.requested, stopped: window.__miraLabMedia.stopped, playbackStarted: window.__miraLabMedia.playbackStarted,
      activeTracks: window.__miraLabMedia.activeTracks, cameraRequested: window.__miraLabMedia.cameraRequested,
    }, interactions: window.__miraInteractionLab.actions }));
    evidence.requests = requests;
    const model = evidence.assets.filter(asset => asset.path.endsWith("/mira-anime-live-v2.vrm"));
    expect(model).toHaveLength(1);
    expect(model[0].decodedBytes).toBeGreaterThan(0);
    expect(evidence.load.callStartToReadyMs).toBeGreaterThan(0);
    expect(evidence.load.webglVersion).toContain("WebGL");
    expect(evidence.final.avatar.contextLost).toBe(0);
    expect(evidence.samples.every(sample => sample.drawCalls > 0 && sample.rAFCallbacks > 1 && sample.medianRAFIntervalMs > 0)).toBe(true);
    expect(requests).toMatchObject({ session: 1, chat: 0, speech: 1, unexpected: [] });
    // A long observation can cross the normal 10s silence restart. Verify
    // complete cleanup, not an incorrect exactly-one permission assumption.
    expect(evidence.final.media.requested).toBeGreaterThan(0);
    expect(evidence.final.media.stopped).toBe(evidence.final.media.requested);
    expect(evidence.final.media).toMatchObject({ activeTracks: 0, cameraRequested: 0, playbackStarted: 1 });
  } finally {
    await testInfo.attach("avatar-lab-measurements", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
    await context.close();
  }
});
