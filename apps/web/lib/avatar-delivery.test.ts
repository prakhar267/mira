import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { avatarDelivery, fetchAvatarDelivery } from "./avatar-delivery";
import losslessDelivery from "./avatar-delivery-manifest.json";
import callV2 from "./avatar-call-v2-manifest.json";
import { MeshoptDecoder } from "meshoptimizer/decoder";
import { decodeAvatarMesh } from "./avatar-mesh-codec";
// @ts-expect-error Deliberate standalone Node asset tool.
import { decodeGlb } from "../scripts/avatar-delivery.mjs";

const asset = (path: string) => readFile(new URL(`../public${path}`, import.meta.url));
afterEach(() => vi.unstubAllGlobals());

describe("verified avatar delivery profiles", () => {
  it("preserves every geometry view, rig, expression and licence; textures decode to identical RGBA pixels", async () => {
    const avatarDelivery = losslessDelivery;
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

  it("bounds the fast profile, preserves geometry/rig and verifies texture quality against resized originals", async () => {
    const avatarDelivery = callV2;
    const source = decodeGlb(await asset("/assets/mira/avatar/mira-anime-live-v2.vrm"));
    const compressed = await asset(avatarDelivery.path), delivered = decodeGlb(gunzipSync(compressed));
    expect(compressed.length).toBeLessThan(1_300_000);
    expect(avatarDelivery.portraitBytes).toBeLessThan(40_000);
    expect(avatarDelivery.pixelIdentical).toBe(false);
    expect((await asset(avatarDelivery.rawPath)).equals(gunzipSync(compressed))).toBe(true);
    for (const key of ["asset", "accessors", "nodes", "meshes", "skins", "materials", "scenes", "samplers", "extensions"]) expect(delivered.model[key]).toEqual(source.model[key]);
    for (let index = 0; index < 879; index++) {
      const old = source.model.bufferViews[index], next = delivered.model.bufferViews[index];
      expect(delivered.binary.subarray(next.byteOffset, next.byteOffset + next.byteLength).equals(source.binary.subarray(old.byteOffset, old.byteOffset + old.byteLength))).toBe(true);
    }
    for (let index = 0; index < 19; index++) {
      const view = source.model.bufferViews[source.model.images[index].bufferView];
      const edge = index === 18 ? 384 : 1024;
      const resized = await sharp(source.binary.subarray(view.byteOffset, view.byteOffset + view.byteLength)).resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true }).png().toBuffer();
      const reference = await sharp(resized).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const next = delivered.model.bufferViews[delivered.model.images[index].bufferView];
      const output = await sharp(index === 18 ? await asset(avatarDelivery.portraitPath) : delivered.binary.subarray(next.byteOffset, next.byteOffset + next.byteLength)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      expect(output.info).toEqual(reference.info);
      let error = 0, weight = 0;
      for (let p = 0; p < output.data.length; p += 4) {
        if (output.data[p + 3] !== reference.data[p + 3]) throw Error("Alpha changed");
        const alpha = reference.data[p + 3]! / 255;
        for (let c = 0; c < 3; c++) error += Math.abs(output.data[p + c]! - reference.data[p + c]!) * alpha;
        weight += 3 * alpha;
      }
      expect(weight ? error / weight : 0).toBeLessThan(5);
    }
  }, 30_000);

  it("uses the bounded fast raw GLB without downloading the original VRM on older browsers", async () => {
    vi.stubGlobal("DecompressionStream", undefined);
    const bytes = await asset(avatarDelivery.rawPath);
    const mock = vi.fn().mockResolvedValue(new Response(bytes)); vi.stubGlobal("fetch", mock);
    expect(Buffer.from(await fetchAvatarDelivery(new AbortController().signal)).equals(bytes)).toBe(true);
    expect(mock).toHaveBeenCalledOnce();
    expect(mock.mock.calls[0]?.[0]).toContain(avatarDelivery.rawPath);
  });

  it("loads, bounds, verifies and decompresses the actual committed payload", async () => {
    const compressed = await asset(avatarDelivery.meshPath);
    const fetchMock = vi.fn().mockResolvedValue(new Response(compressed)); vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;
    expect(Buffer.from(await fetchAvatarDelivery(signal)).equals(await asset(avatarDelivery.rawPath))).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ signal, credentials: "omit", redirect: "error" });
  });
  it("rejects corrupt and truncated payloads without a second download", async () => {
    for (const bytes of [Buffer.alloc(avatarDelivery.meshBytes), Buffer.alloc(10), Buffer.alloc(avatarDelivery.meshBytes + 1)]) {
      const mock = vi.fn().mockResolvedValue(new Response(bytes)); vi.stubGlobal("fetch", mock);
      await expect(fetchAvatarDelivery(new AbortController().signal)).rejects.toThrow();
      expect(mock).toHaveBeenCalledOnce();
    }
  });
  it("retains verified gzip compatibility without WebAssembly", async () => {
    vi.stubGlobal("WebAssembly", undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(await asset(avatarDelivery.path))));
    expect(Buffer.from(await fetchAvatarDelivery(new AbortController().signal)).equals(await asset(avatarDelivery.rawPath))).toBe(true);
  });
  it("bounds precision only in render attributes; rig, weights, topology and textures stay byte-identical", async () => {
    const old = await asset(callV2.rawPath), next = await asset(avatarDelivery.rawPath);
    const source = decodeGlb(old), delivered = decodeGlb(next);
    expect(delivered.model).toEqual(source.model);
    const immutable = new Set<number>();
    for (const mesh of source.model.meshes) for (const primitive of mesh.primitives) {
      immutable.add(primitive.indices);
      for (const [kind, id] of Object.entries(primitive.attributes)) if (/^(JOINTS|WEIGHTS)_/.test(kind)) immutable.add(id as number);
    }
    for (const skin of source.model.skins) immutable.add(skin.inverseBindMatrices);
    for (const id of immutable) {
      const accessor = source.model.accessors[id]; if (!accessor) continue;
      const v = source.model.bufferViews[accessor.bufferView]; if (!v) continue;
      expect(delivered.binary.subarray(v.byteOffset, v.byteOffset + v.byteLength).equals(source.binary.subarray(v.byteOffset, v.byteOffset + v.byteLength))).toBe(true);
    }
    const base = old.length - source.binary.length, allowed = new Set<number>();
    for (const mesh of source.model.meshes) for (const primitive of mesh.primitives) {
      for (const attributes of [primitive.attributes, ...(primitive.targets ?? [])]) for (const [kind, id] of Object.entries(attributes)) {
        if (!/^(POSITION|NORMAL|TANGENT|TEXCOORD_\d+)$/.test(kind)) continue;
        const a = source.model.accessors[id as number]; if (a.componentType !== 5126) continue;
        const count = ({ VEC2: 2, VEC3: 3, VEC4: 4 } as Record<string, number>)[a.type]!;
        for (const [viewId, length, offset] of [[a.bufferView, a.count, a.byteOffset ?? 0], [a.sparse?.values?.bufferView, a.sparse?.count, a.sparse?.values?.byteOffset ?? 0]]) {
          if (viewId === undefined) continue;
          const view = source.model.bufferViews[viewId], stride = view.byteStride ?? count * 4;
          for (let i = 0; i < length; i++) for (let c = 0; c < count; c++) {
            const position = base + view.byteOffset + offset + i * stride + c * 4;
            allowed.add(position);
            if (Math.abs(old.readFloatLE(position) - next.readFloatLE(position)) >= 0.000062) throw Error("Attribute precision budget exceeded");
          }
        }
      }
    }
    for (let offset = 0; offset < old.length; offset += 4) {
      if (old.readUInt32LE(offset) !== next.readUInt32LE(offset) && !allowed.has(offset)) throw Error(`Non-render attribute changed at ${offset}`);
    }
    await MeshoptDecoder.ready;
    const packed = gunzipSync(await asset(avatarDelivery.meshPath));
    expect(Buffer.from(decodeAvatarMesh(packed, next.length, MeshoptDecoder)).equals(next)).toBe(true);
    expect(avatarDelivery.meshBytes).toBeLessThan(900_000);
  });
  it("does not decode an abandoned call", async () => {
    const controller = new AbortController(); controller.abort();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(await asset(avatarDelivery.path))));
    await expect(fetchAvatarDelivery(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
