import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { cdnAdapter } from "@vinext/cloudflare/cache/cdn-adapter";
import { fileURLToPath } from "node:url";

const cloudflareCdn = cdnAdapter({});
const transformersBrowserBuild = fileURLToPath(new URL("./node_modules/@huggingface/transformers/dist/transformers.web.js", import.meta.url));

export default defineConfig({
  define: { "process.env.MIRA_RELEASE_SHA": JSON.stringify(process.env.GITHUB_SHA ?? "unreleased") },
  ...(process.env.MIRA_SYNTHETIC === "1" ? {server:{host:"127.0.0.1",port:4397,strictPort:true}} : {}),
  worker: {
    format: "es",
  },
  resolve: {
    alias: {
      "node:module": fileURLToPath(new URL("./lib/browser-node-module-shim.ts", import.meta.url)),
      "@huggingface/transformers": transformersBrowserBuild,
    },
  },
  plugins: [
    vinext({
      cache: {
        cdn: {
          adapter: cloudflareCdn.adapter,
          options: cloudflareCdn.options ?? {},
        },
      },
    }),
    cloudflare({
      ...(process.env.MIRA_SYNTHETIC === "1" ? { configPath: "tests/local/wrangler.jsonc" } : {}),
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
});
