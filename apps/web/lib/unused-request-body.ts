/** Dispose unread request streams after an early response. The no-bundle
 * Worker artifact has no Wrangler-injected body-draining middleware. Leaving
 * a small rejected POST unread can break its local workerd proxy connection.
 * No body is decoded, retained or logged; slow/large/infinite inputs are bounded.
 * This is cleanup AFTER authorization/handler completion, never an auth bypass.
 * Apply at the route that owns the final Request as well as the outer Worker:
 * the framework can transfer the incoming body to a replacement Request. */
export async function discardUnusedRequestBody(request: Request): Promise<void> {
  const body = request.body;
  if (!body || request.bodyUsed || body.locked) return;
  const reader = body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 100); });
  try {
    let bytes = 0;
    // Stop after the chunk crossing 64 KiB, at 32 chunks, or after 100 ms.
    // A runtime-provided chunk is inspected only for its length, never copied.
    for (let reads = 0; reads < 32 && bytes < 64 * 1024; reads++) {
      const part = await Promise.race([reader.read(), deadline]);
      if (!part || part.done) return;
      bytes += part.value.byteLength;
    }
  } catch { /* A disconnected body must not replace the handler's response. */ }
  finally {
    clearTimeout(timer);
    // Some stream sources never settle cancellation. Do not await them.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function withRequestBodyCleanup<T extends unknown[]>(handler: (request: Request, ...args: T) => Response | Promise<Response>) {
  return async (request: Request, ...args: T): Promise<Response> => {
    try { return await handler(request, ...args); }
    finally { await discardUnusedRequestBody(request); }
  };
}
