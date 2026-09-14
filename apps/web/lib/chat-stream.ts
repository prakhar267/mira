/** Consume Workers AI SSE without buffering an unnecessarily long spoken reply. */
export async function readChatStream(stream: ReadableStream<Uint8Array>, signal: AbortSignal, spoken: boolean, onText?: (text: string) => Promise<void>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = "", text = "";
  let transportBytes = 0;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const chunk = await reader.read();
      signal.throwIfAborted();
      transportBytes += chunk.value?.byteLength ?? 0;
      if (transportBytes > 512_000) throw new Error("Inference stream exceeded the transport limit");
      pending += chunk.done ? decoder.decode() : decoder.decode(chunk.value, {stream:true});
      if (pending.length > 64_000) throw new Error("Inference stream frame exceeded the limit");
      const lines = pending.split(/\r?\n/);
      pending = chunk.done ? "" : lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        // Some inference gateways keep the transport open after the SSE end
        // marker. The marker, not TCP close, completes this reply.
        if (data === "[DONE]") return text.trim();
        if (!data) continue;
        const part = JSON.parse(data) as {response?:string;error?:unknown};
        if (part.error) throw new Error("Inference stream failed");
        text += part.response ?? "";
        if (text.length > 4000) throw new Error("Inference reply exceeded the limit");
        if (onText) await onText(text);
        // Complete sentences only; do not cut at a token/word or inside reasoning.
        const sentences = text.match(/[^.!?।]+[.!?।]["”’]*(?=\s|$)/gu) ?? [];
        const prefix = sentences.slice(0, 2).join("").trim();
        // A punctuation token may arrive before the closing quote. Do not cut
        // a ready-to-send draft mid-quotation, or drop its closing quote.
        const quoted = (prefix.match(/"/g)?.length ?? 0) % 2 !== 0
          || (prefix.match(/“/g)?.length ?? 0) !== (prefix.match(/”/g)?.length ?? 0);
        if (spoken && !quoted && !/<(?:think|analysis)>/i.test(text) && sentences.length >= 2 && prefix.length >= 60) {
          return prefix;
        }
      }
      if (chunk.done) {
        if (onText) throw new Error("Inference stream ended before its completion marker");
        return text.trim();
      }
    }
  } finally {
    signal.removeEventListener("abort", abort);
    // Cancellation is cleanup, not part of reply latency. An upstream cancel
    // acknowledgement can hang even though we already have the complete reply.
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
