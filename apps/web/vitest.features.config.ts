import { defineConfig } from "vitest/config";
import base from "./vitest.config";
import featureSources from "./tests/feature-coverage-scope.json";

// Every new executable module in the four-feature release, including UI, routes
// and the service worker. Shared application integrations remain in the full
// website report and are exercised by the browser/workerd suites.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    maxWorkers: 1,
    include: [
      "lib/companion-tools.test.ts",
      "lib/feature-validation.test.ts",
      "lib/feature-routes.test.ts",
      "lib/reminders.test.ts",
      "lib/reminder-service-worker.test.ts",
      "lib/service-worker-lifecycle.test.ts",
      "components/companion-tools.test.tsx",
      "components/ReminderSettings.test.tsx",
    ],
    coverage: {
      provider: "v8",
      enabled: true,
      include: featureSources,
      reporter: ["text", "json", "json-summary", "html", "lcov"],
      reportsDirectory: "test-results/coverage-features",
      thresholds: {
        perFile: true,
        statements: 95,
        branches: 95,
        functions: 95,
        lines: 95,
      },
    },
  },
});
