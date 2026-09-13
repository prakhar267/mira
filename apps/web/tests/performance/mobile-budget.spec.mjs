import { test, expect } from "@playwright/test";

test("three cold mobile-emulated landing loads record vitals and asset costs", async ({ browser }, testInfo) => {
  const measurements = [];
  for (let sample = 0; sample < 3; sample++) {
    const context = await browser.newContext({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, serviceWorkers: "block" });
    try {
      await context.route("**/*", route => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
      await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 1_600_000 / 8, uploadThroughput: 750_000 / 8, connectionType: "cellular3g" });
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      await page.addInitScript(() => {
        const metrics = window.__miraPerf = { lcp: 0, cls: 0, session: 0, first: 0, last: 0, longTasks: 0, longTaskMs: 0 };
        new PerformanceObserver(list => { for (const entry of list.getEntries()) metrics.lcp = entry.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            if (entry.hadRecentInput) continue;
            if (entry.startTime - metrics.last > 1000 || entry.startTime - metrics.first > 5000) { metrics.session = 0; metrics.first = entry.startTime; }
            metrics.last = entry.startTime; metrics.session += entry.value; metrics.cls = Math.max(metrics.cls, metrics.session);
          }
        }).observe({ type: "layout-shift", buffered: true });
        new PerformanceObserver(list => { for (const entry of list.getEntries()) { metrics.longTasks++; metrics.longTaskMs += entry.duration; } }).observe({ type: "longtask", buffered: true });
      });
      await page.goto("http://127.0.0.1:4397/", { waitUntil: "load", timeout: 90_000 });
      await page.evaluate(() => document.fonts.ready);
      // CSS background discovery can occur after load during hydration. Do not
      // report an incomplete, deceptively tiny transfer total as an improvement.
      await expect.poll(() => page.evaluate(() => performance.getEntriesByType("resource").some(entry => entry.name.endsWith("/assets/mira/loft-morning.png") && entry.decodedBodySize > 0)), { timeout: 90_000 }).toBe(true);
      // Fixed observation tail after all initial assets load; no user interaction.
      await page.waitForTimeout(1000);
      const result = await page.evaluate(() => ({ ...window.__miraPerf,
        overflow: document.documentElement.scrollWidth > innerWidth,
        assets: performance.getEntriesByType("resource").map(entry => ({ path: new URL(entry.name).pathname, transferBytes: entry.transferSize, decodedBytes: entry.decodedBodySize, durationMs: entry.duration, type: entry.initiatorType })),
      }));
      const scripts = result.assets.filter(asset => asset.type === "script");
      measurements.push({ sample: sample + 1, ...result, scriptDecodedBytes: scripts.reduce((total, asset) => total + asset.decodedBytes, 0) });
      expect(result.lcp).toBeGreaterThan(0);
      expect(result.overflow).toBe(false);
      // 3D belongs to an explicit call, not the public landing critical path.
      expect(result.assets.filter(asset => /\.(?:vrm|glb)(?:$|\?)/i.test(asset.path))).toEqual([]);
    } finally { await context.close(); }
  }
  await testInfo.attach("mobile-emulation-measurements", { body: JSON.stringify({ measuredAt: new Date().toISOString(), conditions: "Local compiled Worker, Chromium, 393x851, cold cache, 4x CPU throttle, 1.6Mbps/150ms; not physical phone or production field data", measurements }, null, 2), contentType: "application/json" });
});
