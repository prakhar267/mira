import { defineConfig } from "@playwright/test";
import config from "./playwright.config.mjs";

// Local baseline against already compiled bytes while independent source work
// proceeds. Never used by CI or claimed as verification of current source.
export default defineConfig({ ...config, testMatch: "**/accessibility.spec.mjs", projects: config.projects.filter(project => project.name === "chromium"),
  reporter: [["list"], ["json", { outputFile: "test-results/accessibility-baseline.json" }]],
  webServer: { ...config.webServer, command: "node scripts/browser-server.mjs --prebuilt" },
});
