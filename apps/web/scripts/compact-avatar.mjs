import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const supportedExtensions = new Set(["VRMC_springBone", "VRMC_vrm", "KHR_materials_unlit", "VRMC_materials_mtoon", "VRMC_node_constraint"]);
const align = length => Math.ceil(length / 4) * 4;

/** Lossless repacking only: identical buffer-view payloads share a byte range.
 * No image/vertex, morph, skeleton, material, metadata or license is changed.
 * View indices stay stable, including VRM extension references. */
export function compactAvatar(input) {
  if (!Buffer.isBuffer(input) || input.length < 28 || input.readUInt32LE(0) !== 0x46546c67 || input.readUInt32LE(4) !== 2 || input.readUInt32LE(8) !== input.length) throw new Error("Expected a complete GLB 2 avatar");
  const jsonLength = input.readUInt32LE(12), binHeader = 20 + jsonLength;
  if (jsonLength % 4 || binHeader + 8 > input.length || input.readUInt32LE(16) !== 0x4e4f534a || input.readUInt32LE(binHeader + 4) !== 0x004e4942 || binHeader + 8 + input.readUInt32LE(binHeader) !== input.length) throw new Error("Expected JSON and one binary GLB chunk");
  const model = JSON.parse(input.subarray(20, binHeader).toString("utf8"));
  if (model.asset?.version !== "2.0" || model.buffers?.length !== 1 || model.buffers[0].uri || !Array.isArray(model.bufferViews) || !model.bufferViews.length || (model.extensionsUsed ?? []).some(name => !supportedExtensions.has(name))) throw new Error("Unsupported avatar buffer layout or extension");
  const binary = input.subarray(binHeader + 8);
  const declaredLength = model.buffers[0].byteLength;
  if (!Number.isSafeInteger(declaredLength) || declaredLength < 1 || declaredLength > binary.length || binary.length - declaredLength > 3) throw new Error("Invalid binary length");
  const payloads = [], unique = new Map();
  let length = 0;
  for (const view of model.bufferViews) {
    const offset = view.byteOffset ?? 0;
    if (view.buffer !== 0 || !Number.isSafeInteger(offset) || offset < 0 || offset % 4 || !Number.isSafeInteger(view.byteLength) || view.byteLength < 1 || offset + view.byteLength > declaredLength || view.extensions) throw new Error("Invalid or unsupported buffer view");
    const bytes = binary.subarray(offset, offset + view.byteLength);
    const hash = createHash("sha256").update(bytes).digest("hex");
    let retained = unique.get(hash);
    if (retained && !retained.bytes.equals(bytes)) throw new Error("Buffer hash collision");
    if (!retained) {
      retained = { offset: length, bytes };
      unique.set(hash, retained);
      const padded = Buffer.alloc(align(bytes.length));
      bytes.copy(padded);
      payloads.push(padded); length += padded.length;
    }
    view.byteOffset = retained.offset;
  }
  model.buffers[0].byteLength = length;
  const json = Buffer.from(JSON.stringify(model));
  const output = Buffer.alloc(28 + align(json.length) + length);
  output.writeUInt32LE(0x46546c67, 0); output.writeUInt32LE(2, 4); output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(align(json.length), 12); output.writeUInt32LE(0x4e4f534a, 16);
  output.fill(0x20, 20, 20 + align(json.length)); json.copy(output, 20);
  const header = 20 + align(json.length);
  output.writeUInt32LE(length, header); output.writeUInt32LE(0x004e4942, header + 4);
  Buffer.concat(payloads).copy(output, header + 8);
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = new URL("../public/assets/mira/avatar/mira-anime-live-v2.vrm", import.meta.url);
  const before = await readFile(target), after = compactAvatar(before);
  if (process.argv.includes("--check")) {
    if (!before.equals(after)) throw new Error("Avatar has duplicate buffer payloads; run assets:avatar and review the binary/hash update");
  } else if (!before.equals(after)) {
    if (after.length >= before.length) throw new Error("Refusing to enlarge the avatar");
    await writeFile(target, after);
  }
  console.log(JSON.stringify({ asset: target.pathname.split("/").at(-1), beforeBytes: before.length, afterBytes: after.length, sha256: createHash("sha256").update(after).digest("hex"), check: process.argv.includes("--check") }));
}
