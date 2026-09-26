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
    include: [
      "lib/**/*.test.ts",
      "components/**/*.test.ts",
      "components/**/*.test.tsx",
    ],
    passWithNoTests: false,
  },
});
