import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { cdnAdapter } from "@vinext/cloudflare/cache/cdn-adapter";

const cloudflareCdn = cdnAdapter({});

export default defineConfig({
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
