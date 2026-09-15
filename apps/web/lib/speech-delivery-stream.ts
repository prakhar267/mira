/** Pull-driven audio delivery. Keep the provider/capacity work alive until the
 * final chunk, and recheck consent at every delivery boundary. No text/audio is
 * persisted here. Already delivered bytes cannot be recalled. */
export function speechDeliveryStream(options: {
  signal: AbortSignal;
  check: (signal: AbortSignal) => Promise<void>;
  work: (emit: (bytes: Uint8Array) => Promise<void>, signal: AbortSignal) => Promise<void>;
  finish: (failed: boolean) => void;
}) {
  const stop = new AbortController(), signal = AbortSignal.any([options.signal, stop.signal]);
  let wake: (() => void) | undefined, demand = false;
  const abort = () => wake?.();
  signal.addEventListener("abort", abort);
  const timer = setTimeout(() => stop.abort(new DOMException("Speech delivery timeout", "TimeoutError")), 12_000);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        let failed = false;
        try {
          await options.work(async bytes => {
            signal.throwIfAborted();
            if (!demand) await new Promise<void>(resolve => { wake = resolve; });
            signal.throwIfAborted(); wake = undefined;
            await options.check(signal);
            signal.throwIfAborted(); demand = false;
            controller.enqueue(bytes);
          }, signal);
          signal.throwIfAborted();
          controller.close();
        } catch {
          failed = true;
          try { controller.error(new Error("Speech interrupted. Please retry this turn.")); } catch { /* Closed by consumer. */ }
        } finally {
          clearTimeout(timer); signal.removeEventListener("abort", abort);
          options.finish(failed);
        }
      })();
    },
    pull() { demand = true; wake?.(); },
    cancel() { stop.abort(new DOMException("Speech canceled", "AbortError")); },
  }, { highWaterMark: 0 });
}
