import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { avatarDelivery, fetchAvatarDelivery } from "./avatar-delivery";
// @ts-expect-error Deliberate standalone Node asset tool.
import { decodeGlb } from "../scripts/avatar-delivery.mjs";

const asset = (path: string) => readFile(new URL(`../public${path}`, import.meta.url));
afterEach(() => vi.unstubAllGlobals());

describe("pixel-identical compressed avatar delivery", () => {
  it("preserves every geometry view, rig, expression and licence; textures decode to identical RGBA pixels", async () => {
    const source = decodeGlb(await asset("/assets/mira/avatar/mira-anime-live-v2.vrm"));
    const compressed = await asset(avatarDelivery.path), delivered = decodeGlb(gunzipSync(compressed));
    expect([...compressed.subarray(0, 10)]).toEqual([31, 139, 8, 0, 0, 0, 0, 0, 2, 255]);
    expect(compressed.length).toBeLessThan(3_500_000);
    for (const key of ["asset", "accessors", "nodes", "meshes", "skins", "materials", "scenes", "samplers", "extensions"]) expect(delivered.model[key]).toEqual(source.model[key]);
    expect(delivered.model.bufferViews).toHaveLength(source.model.bufferViews.length - 1);
    for (let index = 0; index < 879; index++) {
      const old = source.model.bufferViews[index], next = delivered.model.bufferViews[index];
      expect(next.byteLength).toBe(old.byteLength);
      expect(delivered.binary.subarray(next.byteOffset, next.byteOffset + next.byteLength).equals(source.binary.subarray(old.byteOffset, old.byteOffset + old.byteLength))).toBe(true);
    }
    for (let index = 0; index < source.model.images.length; index++) {
      const oldView = source.model.bufferViews[source.model.images[index].bufferView];
      const old = source.binary.subarray(oldView.byteOffset, oldView.byteOffset + oldView.byteLength);
      const nextView = delivered.model.bufferViews[delivered.model.images[index].bufferView];
      const next = index === 18 ? await asset(avatarDelivery.portraitPath) : delivered.binary.subarray(nextView.byteOffset, nextView.byteOffset + nextView.byteLength);
      expect((await sharp(next).ensureAlpha().raw().toBuffer()).equals(await sharp(old).ensureAlpha().raw().toBuffer())).toBe(true);
    }
    expect(delivered.model.images[18]).toEqual({ name: "Thumbnail", uri: "mira-anime-live-v2.png", mimeType: "image/png" });
    delivered.model.textures.forEach((texture: { sampler: number; extensions: { EXT_texture_webp: { source: number } } }, index: number) => {
      expect(texture).toEqual({ sampler: source.model.textures[index].sampler, extensions: { EXT_texture_webp: { source: source.model.textures[index].source } } });
    });
  }, 30_000);

  it("loads, bounds, verifies and decompresses the actual committed payload", async () => {
    const compressed = await asset(avatarDelivery.path);
    const fetchMock = vi.fn().mockResolvedValue(new Response(compressed)); vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;
    expect(Buffer.from(await fetchAvatarDelivery(signal)).equals(gunzipSync(compressed))).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ signal, credentials: "omit", redirect: "error" });
  });
  it("rejects corrupt and truncated payloads without a second download", async () => {
    for (const bytes of [Buffer.alloc(avatarDelivery.bytes), Buffer.alloc(10), Buffer.alloc(avatarDelivery.bytes + 1)]) {
      const mock = vi.fn().mockResolvedValue(new Response(bytes)); vi.stubGlobal("fetch", mock);
      await expect(fetchAvatarDelivery(new AbortController().signal)).rejects.toThrow();
      expect(mock).toHaveBeenCalledOnce();
    }
  });
  it("does not decode an abandoned call", async () => {
    const controller = new AbortController(); controller.abort();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(await asset(avatarDelivery.path))));
    await expect(fetchAvatarDelivery(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
