import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      "cloudflare:workers": fileURLToPath(
        new URL("./tests/cloudflare-runtime.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    // Keep the expanded DOM/SQLite suite within hosted-runner memory budgets.
    maxWorkers: 2,
    include: [
      "lib/**/*.test.ts",
      "components/**/*.test.ts",
      "components/**/*.test.tsx",
    ],
    passWithNoTests: false,
  },
});
