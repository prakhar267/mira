import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { cdnAdapter } from "@vinext/cloudflare/cache/cdn-adapter";
import { fileURLToPath } from "node:url";

const cloudflareCdn = cdnAdapter({});
const transformersBrowserBuild = fileURLToPath(new URL("./node_modules/@huggingface/transformers/dist/transformers.web.js", import.meta.url));

export default defineConfig({
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
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
});
