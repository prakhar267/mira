import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: {
    "@": fileURLToPath(new URL("./", import.meta.url)),
    "vinext/server/fetch-handler": fileURLToPath(new URL("./tests/worker/framework-shim.mjs", import.meta.url)),
    "next/server": fileURLToPath(new URL("./tests/worker/framework-shim.mjs", import.meta.url)),
  } },
  plugins: [cloudflareTest({ wrangler: {configPath:"./wrangler.test.jsonc"}, remoteBindings:false, additionalExports:{MockAI:"WorkerEntrypoint",MockProviders:"WorkerEntrypoint"} })],
  test: { include:["tests/worker/**/*.test.mjs"], passWithNoTests:false, fileParallelism:false, testTimeout:20_000 },
});
