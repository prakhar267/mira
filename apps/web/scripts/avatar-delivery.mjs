import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { gzipSync, gunzipSync, brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { compactAvatar } from "./compact-avatar.mjs";
import { packAvatarMesh } from "./avatar-mesh-delivery.mjs";
import { boundCallPrecision } from "./avatar-call-precision.mjs";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const align = n => Math.ceil(n / 4) * 4;
export const sourceDigest = "3b5f011aa01902d8a64788af7713fe317fee3f7a38c0b6300003816f3374e69b";
export function decodeGlb(bytes) {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const n = bytes.readUInt32LE(12);
  return { model: JSON.parse(bytes.subarray(20, 20 + n)), binary: bytes.subarray(28 + n) };
}

// The archival delivery is pixel-identical. The separate call profile resizes
// and compresses textures, never geometry, rigs or expressions.
export async function buildAvatarDelivery(source, { fast = false, meshProfile = false } = {}) {
  // Node's version alone is insufficient: Homebrew links Apple's zlib 1.2.12,
  // while official Node 24.18.0 uses this pinned compressor on macOS/Linux.
  assert.equal(process.versions.zlib, "1.3.1-e00f703", "Use the official Node 24.18.0 binary for deterministic avatar generation/checks (not a system-zlib build)");
  assert.equal(digest(source), sourceDigest, "Review a new source avatar before regenerating delivery");
  assert.ok(compactAvatar(source).equals(source), "Source must be compacted before conversion");
  const { model, binary } = decodeGlb(source);
  const thumbnail = model.extensions.VRMC_vrm.meta.thumbnailImage;
  assert.equal(thumbnail, 18);
  const thumbnailView = model.images[thumbnail].bufferView;
  assert.equal(thumbnailView, model.bufferViews.length - 1);
  assert.ok(model.accessors.every(a => a.bufferView !== thumbnailView && a.sparse?.indices?.bufferView !== thumbnailView && a.sparse?.values?.bufferView !== thumbnailView));
  assert.ok(model.textures.every(t => t.source !== thumbnail && !t.extensions));
  const replacements = new Map(), images = [];
  let portrait;
  for (let index = 0; index < model.images.length; index++) {
    const image = model.images[index], view = model.bufferViews[image.bufferView];
    assert.equal(image.mimeType, "image/png");
    const png = binary.subarray(view.byteOffset, view.byteOffset + view.byteLength);
    const reference = fast ? await sharp(png).resize({ width: index === thumbnail ? 384 : 1024, height: index === thumbnail ? 384 : 1024, fit: "inside", withoutEnlargement: true }).png().toBuffer() : png;
    const webp = await sharp(reference).webp(fast ? { quality: 90, alphaQuality: 100, effort: 6 } : { lossless: true, effort: 6 }).toBuffer();
    const before = await sharp(reference).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const after = await sharp(webp).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.deepEqual(after.info, before.info);
    let visibleRgbError = 0, visibleWeight = 0;
    for (let pixel = 0; pixel < before.data.length; pixel += 4) {
      assert.equal(after.data[pixel + 3], before.data[pixel + 3], "Alpha must survive encoding exactly");
      const weight = before.data[pixel + 3] / 255;
      for (let channel = 0; channel < 3; channel++) visibleRgbError += Math.abs(before.data[pixel + channel] - after.data[pixel + channel]) * weight;
      visibleWeight += 3 * weight;
    }
    const visibleRgbMae = visibleWeight ? visibleRgbError / visibleWeight : 0;
    if (fast) assert.ok(visibleRgbMae < 5, `Texture ${index} exceeds visible RGB quality budget: ${visibleRgbMae}`);
    else assert.ok(after.data.equals(before.data), "Every RGBA pixel must survive lossless encoding");
    images.push({ index, width: before.info.width, height: before.info.height, rgbaSha256: digest(fast ? after.data : before.data), bytes: webp.length, ...(fast ? { visibleRgbMae } : {}) });
    if (index === thumbnail) {
      portrait = webp;
      // Preserve VRM thumbnail metadata as a PNG URI, but don't download the
      // 1.2MB embedded preview again inside the rig. No material references it.
      delete image.bufferView;
      image.uri = "mira-anime-live-v2.png";
    } else {
      replacements.set(image.bufferView, webp);
      image.mimeType = "image/webp";
    }
  }
  for (const texture of model.textures) {
    texture.extensions = { EXT_texture_webp: { source: texture.source } };
    delete texture.source;
  }
  model.extensionsUsed = [...new Set([...model.extensionsUsed, "EXT_texture_webp"])];
  model.extensionsRequired = [...new Set([...(model.extensionsRequired ?? []), "EXT_texture_webp"])];
  model.bufferViews.pop();
  const payloads = [], unique = new Map();
  let length = 0;
  for (const [index, view] of model.bufferViews.entries()) {
    const bytes = replacements.get(index) ?? binary.subarray(view.byteOffset, view.byteOffset + view.byteLength);
    const hash = digest(bytes);
    if (!unique.has(hash)) {
      unique.set(hash, length);
      const padded = Buffer.alloc(align(bytes.length)); bytes.copy(padded);
      payloads.push(padded); length += padded.length;
    }
    view.byteOffset = unique.get(hash); view.byteLength = bytes.length;
  }
  model.buffers[0].byteLength = length;
  const json = Buffer.from(JSON.stringify(model)), jsonLength = align(json.length);
  const glb = Buffer.alloc(28 + jsonLength + length);
  glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(jsonLength, 12); glb.writeUInt32LE(0x4e4f534a, 16);
  glb.fill(32, 20, 20 + jsonLength); json.copy(glb, 20);
  glb.writeUInt32LE(length, 20 + jsonLength); glb.writeUInt32LE(0x004e4942, 24 + jsonLength);
  Buffer.concat(payloads).copy(glb, 28 + jsonLength);
  const precision = meshProfile ? boundCallPrecision(glb, model, 28 + jsonLength) : undefined;
  const gzip = gzipSync(glb, { level: 9 });
  // RFC 1952 OS=255 means unknown. zlib otherwise stamps the host OS (19 on
  // macOS, 3 on Linux), changing the hash of identical compressed content.
  // No header CRC is present; neither the payload nor its CRC is changed.
  assert.equal(gzip[3], 0);
  gzip[9] = 255;
  assert.ok(gunzipSync(gzip).equals(glb), "Gzip must preserve every GLB byte");
  assert.ok(gzip.length < (fast ? 1_300_000 : 3_500_000) && portrait.length < (fast ? 40_000 : 600_000), `Delivery budgets exceeded: model=${gzip.length}, portrait=${portrait.length}`);
  const profile = meshProfile ? "call-v3" : fast ? "call-v2" : "delivery-v1";
  const manifest = { sourceSha256: sourceDigest, path: `/assets/mira/avatar/mira-anime-${profile}.glb.gz`, bytes: gzip.length,
    sha256: digest(gzip), decodedBytes: glb.length, decodedSha256: digest(glb),
    portraitPath: `/assets/mira/avatar/mira-anime-${fast ? "preview-v2" : "portrait-v1"}.webp`, portraitBytes: portrait.length, portraitSha256: digest(portrait), images,
    ...(fast ? { rawPath: `/assets/mira/avatar/mira-anime-${profile}.glb`, textureMaxEdge: 1024, textureQuality: 90, pixelIdentical: false, geometryIdentical: !meshProfile, ...(precision ? { precision } : {}) } : {}) };
  let mesh, wire;
  if (meshProfile) {
    const packed = await packAvatarMesh(glb, model, 28 + jsonLength);
    mesh = gzipSync(packed, { level: 9 }); mesh[9] = 255;
    assert.ok(mesh.length < 900_000, `Mesh delivery budget exceeded: ${mesh.length}`);
    Object.assign(manifest, { meshPath: "/assets/mira/avatar/mira-anime-call-v3.mesh.gz", meshBytes: mesh.length,
      meshSha256: digest(mesh), meshPackedBytes: packed.length });
    // Native DecompressionStream Brotli changes no model bytes. Engines without
    // that format retain the previous gzip transport; no extra decoder download.
    wire = brotliCompressSync(packed, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } });
    assert.ok(brotliDecompressSync(wire).equals(packed));
    assert.ok(wire.length < 820_000);
    Object.assign(manifest, { meshWirePath: "/assets/mira/avatar/mira-anime-call-v3.mesh.br", meshWireBytes: wire.length,
      meshWireSha256: digest(wire), meshPackedSha256: digest(packed) });
  }
  return { gzip, glb, portrait, manifest, mesh, wire };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 for (const [fast, meshProfile] of [[false, false], [true, false], [true, true]]) {
  const result = await buildAvatarDelivery(await readFile(new URL("../public/assets/mira/avatar/mira-anime-live-v2.vrm", import.meta.url)), { fast, meshProfile });
  const files = [
    ["../public" + result.manifest.path, result.gzip],
    ["../public" + result.manifest.portraitPath, result.portrait],
    [`../lib/avatar-${meshProfile ? "call" : fast ? "call-v2" : "delivery"}-manifest.json`, Buffer.from(JSON.stringify(result.manifest, null, 2) + "\n")],
    ...(fast ? [["../public" + result.manifest.rawPath, result.glb]] : []),
    ...(meshProfile ? [["../public" + result.manifest.meshPath, result.mesh]] : []),
    ...(meshProfile ? [["../public" + result.manifest.meshWirePath, result.wire]] : []),
  ];
  for (const [path, bytes] of files) {
    const url = new URL(path, import.meta.url);
    // A mismatch should be a bounded error, not a multi-megabyte binary diff
    // that can exhaust CI log/memory budgets before reporting the cause.
    if (process.argv.includes("--check")) {
      const committed = await readFile(url);
      assert.ok(committed.equals(bytes), `Regenerate ${path}: committed ${committed.length} bytes/${digest(committed)}; generated ${bytes.length} bytes/${digest(bytes)}`);
    }
    else await writeFile(url, bytes);
  }
  console.log(JSON.stringify({ sourceBytes: 9_001_324, deliveryBytes: result.gzip.length, decodedBytes: result.manifest.decodedBytes, portraitBytes: result.portrait.length, check: process.argv.includes("--check") }));
 }
}
