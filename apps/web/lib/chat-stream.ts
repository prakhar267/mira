/** Consume Workers AI SSE without buffering an unnecessarily long spoken reply. */
export async function readChatStream(stream: ReadableStream<Uint8Array>, signal: AbortSignal, spoken: boolean) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = "", text = "";
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const chunk = await reader.read();
      signal.throwIfAborted();
      pending += chunk.done ? decoder.decode() : decoder.decode(chunk.value, {stream:true});
      const lines = pending.split(/\r?\n/);
      pending = chunk.done ? "" : lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        const part = JSON.parse(data) as {response?:string;error?:unknown};
        if (part.error) throw new Error("Inference stream failed");
        text += part.response ?? "";
        if (text.length > 4000) throw new Error("Inference reply exceeded the limit");
        // Complete sentences only; do not cut at a token/word or inside reasoning.
        const sentences = text.match(/[^.!?।]+[.!?।](?=\s|$)/gu) ?? [];
        if (spoken && !/<(?:think|analysis)>/i.test(text) && sentences.length >= 2 && sentences.slice(0,2).join("").length >= 60) {
          return sentences.slice(0,2).join("").trim();
        }
      }
      if (chunk.done) return text.trim();
    }
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
