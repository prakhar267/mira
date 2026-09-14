import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { gzipSync, gunzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { compactAvatar } from "./compact-avatar.mjs";

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

// A delivery derivative, not a replacement for the source VRM. No resize,
// quantization, vertex reduction, AI transform or lossy image encoding.
export async function buildAvatarDelivery(source) {
  assert.equal(digest(source), sourceDigest, "Review a new source avatar before regenerating delivery");
  assert.deepEqual(compactAvatar(source), source);
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
    const webp = await sharp(png).webp({ lossless: true, effort: 6 }).toBuffer();
    const before = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const after = await sharp(webp).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.deepEqual(after.info, before.info);
    assert.deepEqual(after.data, before.data, "Every RGBA pixel must survive lossless encoding");
    images.push({ index, width: before.info.width, height: before.info.height, rgbaSha256: digest(before.data), bytes: webp.length });
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
  const gzip = gzipSync(glb, { level: 9 });
  assert.deepEqual(gunzipSync(gzip), glb);
  assert.ok(gzip.length < 3_500_000 && portrait.length < 600_000, "Delivery budgets exceeded");
  const manifest = { sourceSha256: sourceDigest, path: "/assets/mira/avatar/mira-anime-delivery-v1.glb.gz", bytes: gzip.length,
    sha256: digest(gzip), decodedBytes: glb.length, decodedSha256: digest(glb),
    portraitPath: "/assets/mira/avatar/mira-anime-portrait-v1.webp", portraitBytes: portrait.length, portraitSha256: digest(portrait), images };
  return { gzip, portrait, manifest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await buildAvatarDelivery(await readFile(new URL("../public/assets/mira/avatar/mira-anime-live-v2.vrm", import.meta.url)));
  const files = [
    ["../public" + result.manifest.path, result.gzip],
    ["../public" + result.manifest.portraitPath, result.portrait],
    ["../lib/avatar-delivery-manifest.json", Buffer.from(JSON.stringify(result.manifest, null, 2) + "\n")],
  ];
  for (const [path, bytes] of files) {
    const url = new URL(path, import.meta.url);
    if (process.argv.includes("--check")) assert.deepEqual(await readFile(url), bytes, `Regenerate ${path}`);
    else await writeFile(url, bytes);
  }
  console.log(JSON.stringify({ sourceBytes: 9_001_324, deliveryBytes: result.gzip.length, decodedBytes: result.manifest.decodedBytes, portraitBytes: result.portrait.length, check: process.argv.includes("--check") }));
}
