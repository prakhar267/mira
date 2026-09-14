import {defineConfig,devices} from "@playwright/test";
export default defineConfig({
  testDir:"./tests/browser",fullyParallel:false,workers:1,forbidOnly:Boolean(process.env.CI),retries:0,timeout:45_000,
  // Cold asset loading is not a provider latency measurement. Assert eventual
  // control state; conversational stage latency has separate instrumentation.
  expect:{timeout:15_000},
  reporter:[["list"],["json",{outputFile:"test-results/browser-results.json"}]],
  outputDir:"test-results/browser-artifacts",
  use:{baseURL:"http://127.0.0.1:4397",trace:"retain-on-failure",screenshot:"only-on-failure"},
  projects:[{name:"chromium",use:{...devices["Desktop Chrome"]}},{name:"firefox",use:{...devices["Desktop Firefox"]}},{name:"webkit",use:{...devices["Desktop Safari"]}}],
  webServer:{command:"node scripts/browser-server.mjs",url:"http://127.0.0.1:4397",reuseExistingServer:false,timeout:240_000,gracefulShutdown:{signal:"SIGTERM",timeout:5000}},
});
