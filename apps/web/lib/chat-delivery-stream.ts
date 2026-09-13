import { EdgeRequestError, recordServiceMetric } from "./edge-security";
import { CHAT_STREAM_TYPE, type ChatStreamEvent } from "./chat-stream-protocol";

type Reply = { reply: string; model: string };
/** One outstanding frame, pull-driven with no application prefetch queue.
 * Recheck authorization at the delivery boundary, not only provider start.
 * Bytes already passed to the network cannot be recalled after withdrawal. */
export function chatDeliveryStream(options: {
  requestId: string; startedAt: number; signal: AbortSignal;
  check: (signal: AbortSignal) => Promise<void>;
  work: (onPrefix: (prefix: string, providerSignal?: AbortSignal) => Promise<void>, signal: AbortSignal) => Promise<Reply>;
}) {
  const stop = new AbortController(), signal = AbortSignal.any([options.signal, stop.signal]);
  // This also bounds waiting to send done/error when a client never reads.
  const lifetime = setTimeout(() => stop.abort(new DOMException("Chat delivery deadline exceeded", "TimeoutError")), 15_000);
  const abortable = async <T,>(promise: Promise<T>, active = signal) => {
    active.throwIfAborted(); let cancel: (() => void) | undefined;
    try { return await Promise.race([promise, new Promise<never>((_, reject) => { cancel = () => reject(active.reason); active.addEventListener("abort", cancel, { once: true }); })]); }
    finally { if (cancel) active.removeEventListener("abort", cancel); }
  };
  let demand: (() => void) | undefined, waiting: Promise<void> | undefined, hasDemand = false, sent = "", frames = 0;
  const abort = () => { demand?.(); };
  signal.addEventListener("abort", abort);
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
      const emit = async (event: ChatStreamEvent, check = true, providerSignal?: AbortSignal) => {
        const active = providerSignal ? AbortSignal.any([signal, providerSignal]) : signal;
        active.throwIfAborted();
        if (!hasDemand) {
          waiting ??= new Promise<void>(resolve => { demand = resolve; });
          await abortable(waiting, active);
        }
        active.throwIfAborted(); waiting = undefined; demand = undefined;
        if (check) await abortable(options.check(signal), active);
        active.throwIfAborted(); hasDemand = false; controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      let failed = false;
      try {
        const result = await abortable(options.work(async (prefix, providerSignal) => {
          // Bound authorization reads and frame overhead for punctuation-heavy
          // output. Remaining verified text arrives in the final done event.
          if (frames >= 8) return;
          if (!prefix.startsWith(sent)) throw new EdgeRequestError("The answer changed while streaming. Retry this turn.", 503, "STREAM_CHANGED");
          const delta = prefix.slice(sent.length);
          if (!delta) return;
          await emit({ type: "delta", text: delta, requestId: options.requestId }, true, providerSignal); sent = prefix; frames++;
        }, signal));
        if (!result.reply.startsWith(sent)) throw new EdgeRequestError("The answer changed while streaming. Retry this turn.", 503, "STREAM_CHANGED");
        await emit({ type: "done", ...result, requestId: options.requestId });
      } catch (cause) {
        failed = true;
        if (!signal.aborted) {
          const error = cause instanceof EdgeRequestError ? cause : new EdgeRequestError("Mira could not finish this reply. Retry the same turn.", 503, "STREAM_FAILED");
          await emit({ type: "error", error: error.message, code: error.code, status: error.status, requestId: options.requestId, ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}) }, false).catch(() => undefined);
        }
      } finally {
        clearTimeout(lifetime);
        signal.removeEventListener("abort", abort);
        try { controller.close(); } catch { /* Consumer already canceled. */ }
        recordServiceMetric("companion-chat", failed, Date.now() - options.startedAt);
        console.log(JSON.stringify({ event: "edge_stream_complete", requestId: options.requestId, route: "companion-chat", failed, canceled: signal.aborted, latencyMs: Date.now() - options.startedAt }));
      }
      })();
    },
    pull() { hasDemand = true; demand?.(); },
    cancel() { stop.abort(new DOMException("Chat stream canceled", "AbortError")); },
  }, { highWaterMark: 0 });
  return new Response(body, { headers: { "content-type": `${CHAT_STREAM_TYPE}; charset=utf-8`, "cache-control": "no-store, no-transform", "x-content-type-options": "nosniff", "x-request-id": options.requestId } });
}
