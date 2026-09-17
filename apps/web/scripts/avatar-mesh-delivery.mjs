import assert from "node:assert/strict";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";
import { decodeAvatarMesh } from "../lib/avatar-mesh-codec.ts";
import { gzipSync } from "node:zlib";

/** Only aligned geometry views use lossless meshoptimizer v0. Other bytes are
 * copied verbatim. No quantization, permutation or visual change. */
export async function packAvatarMesh(glb, model, binaryOffset, { adaptive = false } = {}) {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const images = new Set(model.images.map(image => image.bufferView)), seen = new Set(), regions = [];
  const dimensions = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  const sizes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
  for (const [index, view] of model.bufferViews.entries()) {
    const accessor = model.accessors.find(a => a.bufferView === index || a.sparse?.values?.bufferView === index);
    if (images.has(index) || seen.has(view.byteOffset)) continue;
    const element = accessor ? dimensions[accessor.type] * sizes[accessor.componentType] : 4;
    // Indices/sparse index lists are also losslessly compressible as groups of
    // four bytes. This is transport only, not a change to accessor interpretation.
    const stride = view.byteStride ?? element;
    if (!stride || (stride % 4 && stride !== 2) || stride > 256 || view.byteLength % stride) continue;
    seen.add(view.byteOffset);
    regions.push({ offset: binaryOffset + view.byteOffset, length: view.byteLength, stride });
  }
  regions.sort((a, b) => a.offset - b.offset);
  const chunks = []; let cursor = 0;
  const block = (raw, stride) => {
    let encoded = stride === 2 ? MeshoptEncoder.encodeIndexSequence(raw, raw.length / stride, stride) : stride ? MeshoptEncoder.encodeVertexBufferLevel(raw, raw.length / stride, stride, 3, 0) : raw;
    if (adaptive && stride) {
      // Select a lossless layout by its actual wire cost, not the accessor's
      // render layout. Version is embedded in Meshopt's header; the existing
      // bounded decoder supports both. No floats, skin weights or UVs change.
      let cost = gzipSync(encoded, { level: 9 }).length;
      const consider = (candidate, candidateStride) => {
        const bytes = gzipSync(candidate, { level: 9 }).length;
        if (bytes < cost) { cost = bytes; encoded = candidate; stride = candidateStride; }
      };
      consider(raw, 0);
      for (const size of [4, 8, 12, 16, 32, 64, 128, 256]) {
        if (raw.length % size) continue;
        for (const version of [0, 1]) consider(MeshoptEncoder.encodeVertexBufferLevel(raw, raw.length / size, size, 3, version), size);
      }
    }
    const header = Buffer.alloc(12);
    header.writeUInt32LE(raw.length, 0); header.writeUInt32LE(encoded.length, 4); header.writeUInt32LE(stride, 8);
    chunks.push(header, encoded);
  };
  for (const region of regions) {
    assert.ok(region.offset >= cursor && region.offset + region.length <= glb.length, "Overlapping geometry views");
    if (region.offset > cursor) block(glb.subarray(cursor, region.offset), 0);
    block(glb.subarray(region.offset, region.offset + region.length), region.stride);
    cursor = region.offset + region.length;
  }
  if (cursor < glb.length) block(glb.subarray(cursor), 0);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x31504d4d, 0); header.writeUInt32LE(glb.length, 4); header.writeUInt32LE(chunks.length / 2, 8);
  const packed = Buffer.concat([header, ...chunks]);
  assert.ok(Buffer.from(decodeAvatarMesh(packed, glb.length, MeshoptDecoder)).equals(glb), "Mesh transport must restore every GLB byte");
  return packed;
}
