import { defineConfig } from "@playwright/test";
import config from "./playwright.config.mjs";

export default defineConfig({ ...config, testDir: "./tests/performance", timeout: 180_000,
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  reporter: [["list"], ["json", { outputFile: "test-results/performance-results.json" }]],
});
