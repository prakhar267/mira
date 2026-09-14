import { test, expect } from "@playwright/test";
import manifest from "../../lib/avatar-call-manifest.json" with { type: "json" };
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");

test("the actual bounded mesh loader reconstructs the committed GLB in this browser", async ({ page, context }) => {
  const bundled = await build({ entryPoints: [new URL("../../lib/avatar-delivery.ts", import.meta.url).pathname], bundle: true, write: false, platform: "browser", format: "esm" });
  await context.route("**/*", route => new URL(route.request().url()).origin === "http://127.0.0.1:4397" ? route.continue() : route.abort());
  await page.route("**/__qa/avatar-loader.js", route => route.fulfill({ contentType: "application/javascript", body: bundled.outputFiles[0].text }));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { fetchAvatarDelivery } = await import("/__qa/avatar-loader.js");
    const bytes = await fetchAvatarDelivery(new AbortController().signal);
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
    return { bytes: bytes.byteLength, hash };
  });
  expect(result).toEqual({ bytes: manifest.decodedBytes, hash: manifest.decodedSha256 });
});

test("native gzip and every call-profile WebP avatar texture decode in this browser", async ({ page, context }) => {
  await context.route("**/*", route => new URL(route.request().url()).origin === "http://127.0.0.1:4397" ? route.continue() : route.abort());
  await page.goto("/");
  const result = await page.evaluate(async manifest => {
    const response = await fetch(manifest.path);
    const compressed = await response.arrayBuffer();
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
    const bytes = await new Response(stream).arrayBuffer();
    const view = new DataView(bytes), size = view.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, size)));
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
    const dimensions = [];
    for (const image of json.images.slice(0, 18)) {
      const buffer = json.bufferViews[image.bufferView];
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes, 28 + size + buffer.byteOffset, buffer.byteLength)], { type: image.mimeType }));
      try { const element = new Image(); element.src = url; await element.decode(); dimensions.push([element.naturalWidth, element.naturalHeight]); }
      finally { URL.revokeObjectURL(url); }
    }
    return { compressed: compressed.byteLength, decoded: bytes.byteLength, hash, dimensions };
  }, manifest);
  expect(result).toEqual({ compressed: manifest.bytes, decoded: manifest.decodedBytes, hash: manifest.decodedSha256,
    dimensions: manifest.images.slice(0, 18).map(image => [image.width, image.height]) });
});
