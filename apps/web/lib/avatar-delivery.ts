import manifest from "./avatar-call-manifest.json";

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

/** Decompresses only our bounded, hash-verified static derivative. No remote
 * models, decoder bundle, image service or inference is involved. */
export async function fetchAvatarDelivery(signal: AbortSignal) {
  signal.throwIfAborted();
  const gzip = typeof DecompressionStream === "function";
  const path = gzip ? manifest.path : manifest.rawPath;
  const hash = gzip ? manifest.sha256 : manifest.decodedSha256;
  const response = await fetch(`${path}?v=${hash.slice(0, 16)}`, { signal, credentials: "omit", redirect: "error" });
  if (!response.ok || !response.body) throw new Error("Avatar download unavailable");
  const compressed = await boundedBytes(response.body, gzip ? manifest.bytes : manifest.decodedBytes);
  signal.throwIfAborted();
  await verify(compressed, hash);
  signal.throwIfAborted();
  if (!gzip) return compressed.buffer;
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
  const bytes = await boundedBytes(stream, manifest.decodedBytes);
  signal.throwIfAborted();
  await verify(bytes, manifest.decodedSha256);
  signal.throwIfAborted();
  return bytes.buffer;
}
