import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";
export default mergeConfig(
  base,
  defineConfig({
    test: {
      maxWorkers: 2,
      testTimeout: 30_000,
      coverage: {
        provider: "v8",
        enabled: true,
        include: [
          "app/**/*.{ts,tsx}",
          "components/**/*.{ts,tsx}",
          "lib/**/*.{ts,tsx}",
          "worker.ts",
          "public/sw.js",
        ],
        exclude: ["**/*.test.*", "**/*.d.ts"],
        reporter: ["text-summary", "json", "json-summary", "html", "lcov"],
        reportsDirectory: "test-results/coverage-website",
        thresholds: { statements: 95, branches: 95, functions: 95, lines: 95 },
      },
    },
  }),
);
