export const CHAT_STREAM_TYPE = "application/x-ndjson";
export type ChatStreamEvent =
  | { type: "delta"; text: string; requestId: string }
  | { type: "done"; reply: string; model: string; requestId: string }
  | { type: "error"; error: string; code: string; status: number; requestId: string; retryAfterSeconds?: number };

export class CompanionRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code: string, readonly requestId?: string, readonly retryAfterSeconds?: number) { super(message); this.name = "CompanionRequestError"; }
}

/** A terminal done event, not HTTP 200 or transport EOF, authorizes persistence. */
export async function readCompanionReplyStream(body: ReadableStream<Uint8Array>, signal: AbortSignal, onDelta?: (delta: string) => void) {
  const reader = body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  let pending = "", displayed = "";
  const fail = () => new CompanionRequestError("The reply stream ended before a complete answer. Retry this turn.", 503, "INCOMPLETE_STREAM");
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const part = await reader.read(); signal.throwIfAborted();
      pending += part.done ? decoder.decode() : decoder.decode(part.value, { stream: true });
      if (pending.length > 20_000) throw fail();
      const lines = pending.split("\n"); pending = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as Partial<ChatStreamEvent>;
        if (event.type === "error" && typeof event.error === "string" && typeof event.code === "string" && typeof event.status === "number") throw new CompanionRequestError(event.error, event.status, event.code, event.requestId, event.retryAfterSeconds);
        if (event.type === "delta" && typeof event.text === "string") {
          displayed += event.text;
          if (displayed.length > 4_000) throw fail();
          signal.throwIfAborted(); onDelta?.(event.text);
        } else if (event.type === "done" && typeof event.reply === "string" && typeof event.model === "string") {
          if (!event.reply.trim() || event.reply.length > 4_000 || !event.reply.startsWith(displayed)) throw fail();
          signal.throwIfAborted();
          return { reply: event.reply, model: event.model };
        } else throw fail();
      }
      if (part.done) throw fail();
    }
  } catch (cause) {
    signal.throwIfAborted();
    if (cause instanceof CompanionRequestError) throw cause;
    throw fail();
  } finally {
    signal.removeEventListener("abort", abort);
    void reader.cancel().catch(() => undefined); reader.releaseLock();
  }
}
