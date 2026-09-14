import { describe, expect, it } from "vitest";
import { decodeAvatarMesh } from "./avatar-mesh-codec";
import { MeshoptDecoder } from "meshoptimizer/decoder";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import manifest from "./avatar-call-manifest.json";

describe("bounded avatar mesh transport", () => {
  it("rejects malformed headers, lengths, counts, strides and trailing bytes", async () => {
    await MeshoptDecoder.ready;
    const source = gunzipSync(await readFile(new URL(`../public${manifest.meshPath}`, import.meta.url)));
    for (const [offset, value] of [[0, 0], [4, 4_000_001], [8, 2049], [12, 0], [12, 0xffffffff], [16, 0xffffffff], [20, 3], [20, 260]]) {
      const corrupt = Buffer.from(source); corrupt.writeUInt32LE(value!, offset!);
      expect(() => decodeAvatarMesh(corrupt, manifest.decodedBytes, MeshoptDecoder)).toThrow();
    }
    for (const value of [source.subarray(0, 10), source.subarray(0, -1), Buffer.concat([source, Buffer.alloc(1)])]) {
      expect(() => decodeAvatarMesh(value, manifest.decodedBytes, MeshoptDecoder)).toThrow();
    }
  });
  it("refuses work after hang-up", () => {
    const abort = new AbortController(); abort.abort();
    expect(() => decodeAvatarMesh(new Uint8Array(), 100, MeshoptDecoder, abort.signal)).toThrow();
  });
});
