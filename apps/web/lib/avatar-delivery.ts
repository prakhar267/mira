import manifest from "./avatar-call-manifest.json";
import { decodeAvatarMesh } from "./avatar-mesh-codec";

export { manifest as avatarDelivery };

async function boundedBytes(stream: ReadableStream<Uint8Array>, expected: number) {
  const reader = stream.getReader(), output = new Uint8Array(expected);
  let offset = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.length > expected) throw new Error("Avatar exceeds delivery budget");
      output.set(value, offset); offset += value.length;
    }
    if (offset !== expected) throw new Error("Incomplete avatar delivery");
    return output;
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

async function verify(bytes: Uint8Array<ArrayBuffer>, expected: string) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  if (Array.from(hash, byte => byte.toString(16).padStart(2, "0")).join("") !== expected) throw new Error("Avatar integrity check failed");
}

/** Downloads only a bounded, hash-verified static derivative. A small local
 * lossless decoder loads alongside it, only after the call opens. */
export async function fetchAvatarDelivery(signal: AbortSignal) {
  signal.throwIfAborted();
  const gzip = typeof DecompressionStream === "function";
  const mesh = gzip && typeof WebAssembly === "object";
  let brotli: DecompressionStream | null = null;
  if (mesh) { try { brotli = new DecompressionStream("brotli" as CompressionFormat); } catch { /* Older engines keep the verified gzip path. */ } }
  const decoder = mesh ? import("meshoptimizer/decoder").then(async ({ MeshoptDecoder }) => {
    await MeshoptDecoder.ready; return MeshoptDecoder;
  }) : undefined;
  // A failed/aborted download must not leave an unhandled dynamic-import error.
  void decoder?.catch(() => undefined);
  const path = brotli ? manifest.meshWirePath : mesh ? manifest.meshPath : gzip ? manifest.path : manifest.rawPath;
  const hash = brotli ? manifest.meshWireSha256 : mesh ? manifest.meshSha256 : gzip ? manifest.sha256 : manifest.decodedSha256;
  const response = await fetch(`${path}?v=${hash.slice(0, 16)}`, { signal, credentials: "omit", redirect: "error" });
  if (!response.ok || !response.body) throw new Error("Avatar download unavailable");
  const compressed = await boundedBytes(response.body, brotli ? manifest.meshWireBytes : mesh ? manifest.meshBytes : gzip ? manifest.bytes : manifest.decodedBytes);
  signal.throwIfAborted();
  await verify(compressed, hash);
  signal.throwIfAborted();
  if (!gzip) return compressed.buffer;
  const packed = await boundedBytes(new Blob([compressed]).stream().pipeThrough(brotli ?? new DecompressionStream("gzip")), mesh ? manifest.meshPackedBytes : manifest.decodedBytes);
  const bytes = mesh ? decodeAvatarMesh(packed, manifest.decodedBytes, (await decoder)!, signal) : packed;
  signal.throwIfAborted();
  await verify(bytes, manifest.decodedSha256);
  signal.throwIfAborted();
  return bytes.buffer;
}
