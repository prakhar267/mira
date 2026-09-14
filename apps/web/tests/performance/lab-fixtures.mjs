import { expect } from "@playwright/test";

export const labOrigin = "http://127.0.0.1:4397";

// Performance fixtures must never reach a real account, provider or device.
// Unknown API calls fail closed, independently of the compiled runtime's kill
// switch. The pages, JavaScript, styles, images and VRM remain the real build.
export async function isolateDemo(context) {
  const requests = { session: 0, chat: 0, speech: 0, unexpected: [] };
  let consent = false;
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== labOrigin) {
      requests.unexpected.push({ method: request.method(), origin: url.origin, path: url.pathname });
      return route.abort("blockedbyclient");
    }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname === "/api/capabilities" && request.method() === "GET") return route.fulfill({ json: {
      runtime: "cloudflare", mode: consent ? "demo" : "anonymous", policyVersion: "2026-09-13",
      capabilities: { chat: consent, speech: consent, transcription: consent, voiceCall: consent, videoCall: consent, memoryRetrieval: consent,
        imageUpload: false, imageGeneration: false, imageUnderstanding: false, journalReflection: false, scheduledNotifications: false, billing: false },
      voice: { name: "Priya", customization: false },
    } });
    if (url.pathname === "/api/demo/session" && request.method() === "POST") {
      expect(request.postDataJSON()).toMatchObject({ adultDeclared: true, aiProcessingConsent: true, policyVersion: "2026-09-13" });
      requests.session++; consent = true;
      return route.fulfill({ json: { mode: "demo" } });
    }
    if (consent && url.pathname === "/api/companion-chat" && request.method() === "POST") {
      requests.chat++;
      return route.fulfill({ json: { reply: "Your synthetic meeting is Sunday morning.", model: "performance-fixture" } });
    }
    if (consent && url.pathname === "/api/companion-speech" && request.method() === "POST") {
      requests.speech++;
      return route.fulfill({ contentType: "audio/wav", body: Buffer.from("synthetic-performance-audio") });
    }
    requests.unexpected.push({ method: request.method(), path: url.pathname });
    return route.abort("blockedbyclient");
  });
  return requests;
}

export async function enterDemo(page) {
  await page.goto(`${labOrigin}/demo`, { waitUntil: "load" });
  await expect(page.getByRole("checkbox")).toHaveCount(3);
  for (const checkbox of await page.getByRole("checkbox").all()) await checkbox.check();
  await page.getByRole("button", { name: "Meet Mira", exact: true }).click();
  await expect(page.locator(".app-frame")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

export async function coldMobilePage(browser) {
  const context = await browser.newContext({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, serviceWorkers: "block" });
  const requests = await isolateDemo(context);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  return { context, page, requests };
}

// Event Timing is browser-generated, not a stopwatch around Playwright calls.
// Its minimum event threshold is 16ms and durations are quantized to 8ms.
// See https://w3c.github.io/event-timing/. Missing fast entries are censored,
// never filled in as zero; this bounded lab sample is not field INP or P95.
export async function observeInteractions(page) {
  await page.addInitScript(() => {
    const measurements = window.__miraInteractionLab = { events: [], actions: [], supported: PerformanceObserver.supportedEntryTypes.includes("event") };
    if (!measurements.supported) return;
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        if (entry.interactionId > 0 && measurements.events.length < 512) measurements.events.push({
          name: entry.name, interactionId: entry.interactionId, startTime: entry.startTime, durationMs: entry.duration,
          inputDelayMs: entry.processingStart - entry.startTime, processingMs: entry.processingEnd - entry.processingStart,
          approximatePresentationDelayMs: Math.max(0, entry.startTime + entry.duration - entry.processingEnd),
        });
      }
    });
    observer.observe({ type: "event", buffered: true, durationThreshold: 16 });
  });
}

export async function recordInteraction(page, label, perform, confirm) {
  const start = await page.evaluate(() => performance.now());
  await perform();
  await confirm();
  const confirmation = await page.evaluate(() => performance.now());
  // Allow paint and PerformanceObserver delivery before moving to the next
  // labeled action. This tail is excluded from confirmation wall time.
  await page.waitForTimeout(160);
  await page.evaluate(({ label, start, confirmation }) => {
    const lab = window.__miraInteractionLab;
    const events = lab.events.filter(entry => entry.startTime >= start && entry.startTime <= confirmation);
    const interactions = new Map();
    for (const event of events) interactions.set(event.interactionId, Math.max(interactions.get(event.interactionId) ?? 0, event.durationMs));
    lab.actions.push({ label, confirmationWallMs: confirmation - start,
      // Confirmation includes browser-driver transport and assertion polling;
      // it is not an input-to-paint or model/provider latency measurement.
      observedInteractions: [...interactions].map(([interactionId, durationMs]) => ({ interactionId, durationMs })), events,
      missingEventInterpretation: events.length ? null : "No >=16ms Event Timing entry was observed; not a zero-duration measurement.",
    });
  }, { label, start, confirmation });
}

// Controlled audio and silent analyser values exercise actual call/animation
// state changes without opening a microphone, decoding audio, or producing
// sound. They cannot establish acoustic quality, echo behavior or lip-sync.
export async function syntheticCallMedia(page) {
  await page.addInitScript(() => {
    const stats = window.__miraLabMedia = { requested: 0, stopped: 0, activeTracks: 0, cameraRequested: 0, playbackStarted: 0, activeAudio: null };
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
      getUserMedia: async constraints => {
        stats.requested++; stats.activeTracks++;
        if (constraints?.video) stats.cameraRequested++;
        let stopped = false;
        const track = { stop() { if (!stopped) { stopped = true; stats.stopped++; stats.activeTracks--; } } };
        return { getTracks: () => [track] };
      },
    } });
    window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined;
    window.Audio = class {
      duration = 60; paused = false; startedAt = 0;
      get currentTime() { return Math.min(59, (performance.now() - this.startedAt) / 1000); }
      async play() { this.startedAt = performance.now(); stats.playbackStarted++; stats.activeAudio = this; queueMicrotask(() => this.onplaying?.()); }
      pause() { this.paused = true; }
      finish() { this.onended?.(); }
    };
    window.OfflineAudioContext = class {
      async decodeAudioData() { const samples = new Float32Array(60_000).fill(.06); return { sampleRate: 1000, getChannelData: () => samples }; }
    };
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
  });
}

// Test-only wrappers count real WebGL submissions on the application's avatar
// canvas. They do not change rendering arguments or count unrelated canvases.
// Submission activity and rAF cadence are NOT GPU completion or presented FPS.
export async function observeAvatar(page) {
  await page.addInitScript(() => {
    const state = window.__miraAvatarLab = { drawCalls: 0, contextLost: 0, firstDrawAt: null, readyAt: null, renderer: null, webglVersion: null };
    const seen = new WeakSet();
    for (const constructor of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
      if (!constructor) continue;
      for (const method of ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced"]) {
        const original = constructor.prototype[method];
        if (!original) continue;
        constructor.prototype[method] = function (...args) {
          if (this.canvas instanceof HTMLCanvasElement && this.canvas.classList.contains("live-avatar-3d__canvas")) {
            state.drawCalls++;
            if (state.firstDrawAt === null) state.firstDrawAt = performance.now();
            if (!seen.has(this)) {
              seen.add(this); state.webglVersion = this.getParameter(this.VERSION);
              const info = this.getExtension("WEBGL_debug_renderer_info");
              state.renderer = info ? this.getParameter(info.UNMASKED_RENDERER_WEBGL) : this.getParameter(this.RENDERER);
            }
          }
          return original.apply(this, args);
        };
      }
    }
    document.addEventListener("webglcontextlost", event => {
      if (event.target instanceof HTMLCanvasElement && event.target.classList.contains("live-avatar-3d__canvas")) state.contextLost++;
    }, true);
    const observer = new MutationObserver(() => {
      if (state.readyAt === null && document.querySelector(".live-avatar-3d--ready")) state.readyAt = performance.now();
    });
    observer.observe(document, { subtree: true, attributes: true, attributeFilter: ["class"], childList: true });
  });
}

export async function sampleAvatarCadence(page, label, durationMs = 4000) {
  return page.evaluate(async ({ label, durationMs }) => {
    const state = window.__miraAvatarLab, start = performance.now(), drawStart = state.drawCalls;
    const frames = [];
    let previous = null, previousDraw = drawStart;
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error("Avatar frame observation timed out")), durationMs + 5000);
      const frame = timestamp => {
        if (previous !== null) frames.push({ intervalMs: timestamp - previous, drawCallsSincePreviousCallback: state.drawCalls - previousDraw });
        previous = timestamp; previousDraw = state.drawCalls;
        if (timestamp - start < durationMs) requestAnimationFrame(frame);
        else { clearTimeout(deadline); resolve(); }
      };
      requestAnimationFrame(frame);
    });
    const intervals = frames.map(frame => frame.intervalMs).sort((a, b) => a - b);
    return { label, elapsedMs: performance.now() - start, drawCalls: state.drawCalls - drawStart, rAFCallbacks: frames.length + 1,
      medianRAFIntervalMs: intervals[Math.floor(intervals.length / 2)] ?? null, maxRAFIntervalMs: intervals.at(-1) ?? null,
      intervalsOver50ms: intervals.filter(interval => interval > 50).length, frames,
      interpretation: "Instrumented WebGL draw submissions and rAF frame-timing proxy, not actual presented avatar FPS or perceptual lip-sync.",
    };
  }, { label, durationMs });
}
