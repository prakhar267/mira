/** Inworld HTTP streaming is bounded NDJSON, not a concatenated JSON document.
 * Only the first MP3 chunk must have a header: later chunks may split a frame. */
export async function readInworldAudioStream(body: ReadableStream<Uint8Array>, signal: AbortSignal,
  emit: (bytes: Uint8Array) => Promise<void>) {
  const reader = body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  let pending = "", received = 0, audioBytes = 0, records = 0;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  const line = async (value: string) => {
    if (!value.trim()) return;
    if (++records > 512) throw Error("Too many speech frames");
    const frame = JSON.parse(value) as { error?: unknown; result?: { audioContent?: unknown } };
    if (frame.error || !frame.result) throw Error("Invalid speech stream");
    const content = frame.result.audioContent;
    if (content === "" || content === undefined) return; // timestamp-only frame
    if (typeof content !== "string" || !/^[a-z\d+/]+={0,2}$/i.test(content) || content.length % 4 !== 0) throw Error("Invalid speech audio");
    const binary = atob(content), bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    if (!audioBytes && !((bytes[0] === 73 && bytes[1] === 68 && bytes[2] === 51) || (bytes[0] === 255 && (bytes[1]! & 224) === 224))) throw Error("Invalid MP3 header");
    audioBytes += bytes.length;
    if (audioBytes > 8_000_000) throw Error("Speech audio exceeds limit");
    signal.throwIfAborted();
    await emit(bytes);
    signal.throwIfAborted();
  };
  try {
    signal.throwIfAborted();
    for (;;) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      received += value.length;
      if (received > 11_000_000) throw Error("Speech stream exceeds limit");
      pending += decoder.decode(value, { stream: true });
      let boundary: number;
      while ((boundary = pending.indexOf("\n")) >= 0) {
        const next = pending.slice(0, boundary); pending = pending.slice(boundary + 1);
        if (next.length > 1_500_000) throw Error("Speech frame exceeds limit");
        await line(next);
      }
      if (pending.length > 1_500_000) throw Error("Speech frame exceeds limit");
    }
    pending += decoder.decode();
    await line(pending);
    if (!audioBytes) throw Error("Empty speech stream");
    return audioBytes;
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => undefined); reader.releaseLock();
  }
}
