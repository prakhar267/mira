import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
// @ts-expect-error Standalone asset tool intentionally uses the Node .mjs runtime.
import { compactAvatar } from "../scripts/compact-avatar.mjs";

function fixture() {
  const json = Buffer.from(JSON.stringify({ asset: { version: "2.0" }, buffers: [{ byteLength: 12 }],
    bufferViews: [0, 4, 8].map(byteOffset => ({ buffer: 0, byteOffset, byteLength: 4 })),
    extensionsUsed: ["VRMC_vrm"], extensions: { VRMC_vrm: { meta: { name: "Synthetic", authors: ["Synthetic test"], licenseUrl: "https://example.test/license" } } },
    accessors: [{ bufferView: 2, byteOffset: 0, count: 1, componentType: 5126, type: "SCALAR" }],
  }));
  const length = Math.ceil(json.length / 4) * 4;
  const output = Buffer.alloc(28 + length + 12);
  output.writeUInt32LE(0x46546c67, 0); output.writeUInt32LE(2, 4); output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(length, 12); output.writeUInt32LE(0x4e4f534a, 16);
  output.fill(32, 20, 20 + length); json.copy(output, 20);
  output.writeUInt32LE(12, 20 + length); output.writeUInt32LE(0x004e4942, 24 + length);
  Buffer.from([1,2,3,4,5,6,7,8,1,2,3,4]).copy(output, 28 + length);
  return output;
}
function decode(bytes: Buffer) {
  const length = bytes.readUInt32LE(12);
  return { json: JSON.parse(bytes.subarray(20, 20 + length).toString()), binary: bytes.subarray(28 + length) };
}
describe("lossless avatar buffer repacking", () => {
  it("deduplicates identical bytes without changing view indices, accessors or VRM metadata", () => {
    const original = fixture(), before = decode(original), result = compactAvatar(original), after = decode(result);
    expect(result.length).toBeLessThan(original.length);
    expect(after.json.bufferViews.map((view: {byteOffset:number}) => view.byteOffset)).toEqual([0,4,0]);
    for (const key of ["asset", "accessors", "extensionsUsed", "extensions"]) expect(after.json[key]).toEqual(before.json[key]);
    for (let index = 0; index < before.json.bufferViews.length; index++) {
      const old = before.json.bufferViews[index], current = after.json.bufferViews[index];
      expect(after.binary.subarray(current.byteOffset, current.byteOffset + current.byteLength)).toEqual(before.binary.subarray(old.byteOffset, old.byteOffset + old.byteLength));
    }
    expect(compactAvatar(result)).toEqual(result);
    expect(original).toEqual(fixture());
  });
  it("rejects truncated, corrupt or unsupported containers", () => {
    const valid = fixture();
    for (const corrupt of [valid.subarray(0, 12), valid.subarray(0, valid.length - 1), Buffer.alloc(valid.length)]) expect(() => compactAvatar(corrupt)).toThrow();
    const corrupt = Buffer.from(valid); corrupt.writeUInt32LE(3, 4);
    expect(() => compactAvatar(corrupt)).toThrow();
  });
  it("ships the compacted original rig with its exact documented digest", async () => {
    const bytes = await readFile(new URL("../public/assets/mira/avatar/mira-anime-live-v2.vrm", import.meta.url));
    const notice = await readFile(new URL("../public/assets/mira/avatar/LICENSE.md", import.meta.url), "utf8");
    expect(bytes.equals(compactAvatar(bytes))).toBe(true);
    expect(bytes.length).toBeLessThan(9_100_000);
    expect(notice).toContain(createHash("sha256").update(bytes).digest("hex"));
    expect(decode(bytes).json.extensions.VRMC_vrm.meta.authors).toContain("pixiv Inc.");
  });
});
