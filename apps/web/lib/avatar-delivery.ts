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
  const decoder = mesh ? import("meshoptimizer/decoder").then(async ({ MeshoptDecoder }) => {
    await MeshoptDecoder.ready; return MeshoptDecoder;
  }) : undefined;
  // A failed/aborted download must not leave an unhandled dynamic-import error.
  void decoder?.catch(() => undefined);
  // Content-Encoding: br lets the browser's HTTP stack decode the smaller
  // transfer even where DecompressionStream('brotli') is not implemented.
  // Hash the bounded decompressed MMP bytes, then the reconstructed GLB.
  const path = mesh ? manifest.meshHttpPath : gzip ? manifest.path : manifest.rawPath;
  const hash = mesh ? manifest.meshPackedSha256 : gzip ? manifest.sha256 : manifest.decodedSha256;
  const response = await fetch(`${path}?v=${hash.slice(0, 16)}`, { signal, credentials: "omit", redirect: "error" });
  if (!response.ok || !response.body) throw new Error("Avatar download unavailable");
  const compressed = await boundedBytes(response.body, mesh ? manifest.meshPackedBytes : gzip ? manifest.bytes : manifest.decodedBytes);
  signal.throwIfAborted();
  await verify(compressed, hash);
  signal.throwIfAborted();
  if (!gzip) return compressed.buffer;
  const packed = mesh ? compressed : await boundedBytes(new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip")), manifest.decodedBytes);
  const bytes = mesh ? decodeAvatarMesh(packed, manifest.decodedBytes, (await decoder)!, signal) : packed;
  signal.throwIfAborted();
  await verify(bytes, manifest.decodedSha256);
  signal.throwIfAborted();
  return bytes.buffer;
}
