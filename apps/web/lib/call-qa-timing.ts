/** Diagnostic-only helpers. Native playback/ended and reply assertions remain
 * separate: a completed network request alone never means a call passed. */
export async function boundedCallDiagnostic<T>(work: (signal: AbortSignal) => Promise<T>, timeoutMs = 15_000) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new DOMException("Call QA response inspection timed out", "TimeoutError");
          controller.abort(error); reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally { clearTimeout(timer); controller.abort(); }
}

export async function completedRequestTiming(read: () => { responseStart: number; responseEnd: number }, signal: AbortSignal) {
  for (;;) {
    signal.throwIfAborted();
    const timing = read();
    if (Number.isFinite(timing.responseStart) && timing.responseStart >= 0
      && Number.isFinite(timing.responseEnd) && timing.responseEnd >= timing.responseStart) return timing;
    await new Promise<void>((resolve, reject) => {
      const finish = () => { signal.removeEventListener("abort", abort); resolve(); };
      const timer = setTimeout(finish, 25);
      const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(signal.reason); };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }
}
