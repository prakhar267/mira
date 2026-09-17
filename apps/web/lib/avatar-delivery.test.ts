import { readFile } from "node:fs/promises";
import { gunzipSync, brotliDecompressSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { avatarDelivery, fetchAvatarDelivery } from "./avatar-delivery";
import losslessDelivery from "./avatar-delivery-manifest.json";
import callV2 from "./avatar-call-v2-manifest.json";
import callV3 from "./avatar-call-v3-manifest.json";
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
    const fetchMock = vi.fn(async(path:string,init?:RequestInit)=>{expect(init?.credentials).toBe("omit");return new Response(await asset(new URL(path,"https://local.test").pathname));}); vi.stubGlobal("fetch", fetchMock);
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
  it("uses HTTP Brotli even when JavaScript DecompressionStream does not support it",async()=>{
    const Original=DecompressionStream;
    vi.stubGlobal("DecompressionStream",class{constructor(format:CompressionFormat){if(String(format)==="brotli")throw Error("unsupported");return new Original(format);}});
    const mock=vi.fn().mockResolvedValue(new Response(brotliDecompressSync(await asset(avatarDelivery.meshWirePath))));vi.stubGlobal("fetch",mock);
    expect(Buffer.from(await fetchAvatarDelivery(new AbortController().signal)).equals(await asset(avatarDelivery.rawPath))).toBe(true);
    expect(mock.mock.calls[0]?.[0]).toContain(avatarDelivery.meshHttpPath);
    expect(brotliDecompressSync(await asset(avatarDelivery.meshWirePath)).equals(gunzipSync(await asset(avatarDelivery.meshPath)))).toBe(true);
  });
  it("retains verified gzip compatibility without WebAssembly", async () => {
    vi.stubGlobal("WebAssembly", undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(await asset(avatarDelivery.path))));
    expect(Buffer.from(await fetchAvatarDelivery(new AbortController().signal)).equals(await asset(avatarDelivery.rawPath))).toBe(true);
  });
  it("bounds precision only in render attributes; rig, weights, topology and textures stay byte-identical", async () => {
    const avatarDelivery = callV3;
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
  it("keeps every bound VRM expression byte-identical while removing only unused zero-weight morphs", async () => {
    const before = decodeGlb(await asset(callV3.rawPath)), after = decodeGlb(await asset(avatarDelivery.rawPath));
    const viewBytes = (file: typeof before, id: number) => { const view = file.model.bufferViews[id]; return file.binary.subarray(view.byteOffset, view.byteOffset + view.byteLength); };
    const sameBytes = (a: Uint8Array, b: Uint8Array) => expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const sameAccessor = (oldId: number, newId: number) => {
      const a = structuredClone(before.model.accessors[oldId]), b = structuredClone(after.model.accessors[newId]);
      expect(b.bufferView !== undefined).toBe(a.bufferView !== undefined);
      if (a.bufferView !== undefined) { sameBytes(viewBytes(before, a.bufferView), viewBytes(after, b.bufferView)); b.bufferView = a.bufferView; }
      expect(!!b.sparse).toBe(!!a.sparse);
      if (a.sparse) for (const key of ["indices", "values"]) {
        sameBytes(viewBytes(before, a.sparse[key].bufferView), viewBytes(after, b.sparse[key].bufferView));
        b.sparse[key].bufferView = a.sparse[key].bufferView;
      }
      expect(b).toEqual(a);
    };
    for (const key of ["asset", "nodes", "materials", "scenes", "samplers", "textures"]) expect(after.model[key]).toEqual(before.model[key]);
    for (let m = 0; m < before.model.meshes.length; m++) for (let p = 0; p < before.model.meshes[m].primitives.length; p++) {
      const old = before.model.meshes[m].primitives[p], next = after.model.meshes[m].primitives[p];
      sameAccessor(old.indices, next.indices);
      for (const kind of Object.keys(old.attributes)) sameAccessor(old.attributes[kind], next.attributes[kind]);
    }
    for (let i = 0; i < before.model.skins.length; i++) {
      const old = structuredClone(before.model.skins[i]), next = structuredClone(after.model.skins[i]);
      sameAccessor(old.inverseBindMatrices, next.inverseBindMatrices); next.inverseBindMatrices = old.inverseBindMatrices;
      expect(next).toEqual(old);
    }
    for (let i = 0; i < 18; i++) sameBytes(viewBytes(after, after.model.images[i].bufferView), viewBytes(before, before.model.images[i].bufferView));
    for (const group of Object.keys(before.model.extensions.VRMC_vrm.expressions)) for (const [name, original] of Object.entries(before.model.extensions.VRMC_vrm.expressions[group])) {
      const old = structuredClone(original) as {morphTargetBinds?: {node:number;index:number;weight:number}[]};
      const next = structuredClone(after.model.extensions.VRMC_vrm.expressions[group][name]);
      for (let i = 0; i < (old.morphTargetBinds?.length ?? 0); i++) {
        const a = old.morphTargetBinds![i]!, b = next.morphTargetBinds[i], mesh = before.model.nodes[a.node].mesh;
        expect(b.node).toBe(a.node); expect(b.weight).toBe(a.weight);
        for (let p = 0; p < before.model.meshes[mesh].primitives.length; p++) {
          const x = before.model.meshes[mesh].primitives[p].targets[a.index], y = after.model.meshes[mesh].primitives[p].targets[b.index];
          expect(Object.keys(y)).toEqual(Object.keys(x));
          for (const kind of Object.keys(x)) sameAccessor(x[kind], y[kind]);
        }
        b.index = a.index;
      }
      expect(next).toEqual(old);
    }
    const extensions = structuredClone(after.model.extensions); extensions.VRMC_vrm.expressions = before.model.extensions.VRMC_vrm.expressions;
    expect(extensions).toEqual(before.model.extensions);
    expect(avatarDelivery.meshBytes).toBeLessThan(760_000);
    // Adaptive transport restores the exact previous call-v4 geometry, texture,
    // skin weights and rig. No new quantization or character redesign.
    expect(avatarDelivery.decodedSha256).toBe("063b3fe2ca59185e2bc734e0c884e912abbcab8b65a116a89c6d70cb5b1af6b4");
  });
  it("does not decode an abandoned call", async () => {
    const controller = new AbortController(); controller.abort();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(await asset(avatarDelivery.path))));
    await expect(fetchAvatarDelivery(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
