import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/full-stack",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/full-stack-results.json" }],
  ],
  outputDir: "test-results/full-stack-artifacts",
  use: {
    baseURL: "https://127.0.0.1:4398",
    ignoreHTTPSErrors: true,
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: `node scripts/full-stack-server.mjs${process.env.MIRA_FULL_STACK_PREBUILT === "true" ? " --prebuilt" : ""}`,
    url: "https://127.0.0.1:4398/api/health",
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 240_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
  },
});
