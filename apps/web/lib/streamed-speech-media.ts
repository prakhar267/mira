const MP3 = "audio/mpeg";
const LIMIT = 8_000_000;

function event(target: EventTarget, name: string, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const clean = () => { target.removeEventListener(name, done); target.removeEventListener("error", failed); signal.removeEventListener("abort", failed); };
    const done = () => { clean(); resolve(); };
    const failed = () => { clean(); reject(signal.aborted ? signal.reason : Error("Streaming voice could not play")); };
    if (signal.aborted) return failed();
    target.addEventListener(name, done, { once: true }); target.addEventListener("error", failed, { once: true }); signal.addEventListener("abort", failed, { once: true });
  });
}

/** Native audio playback stays the audible path. MP3 MSE starts before EOF on
 * supported browsers; others buffer this SAME response, never a second request.
 * No AudioContext is connected to the speakers (important on mobile Safari). */
export function streamSpeechMedia(audio: HTMLAudioElement, response: Response, signal: AbortSignal,
  onBuffer: (blob: Blob) => void = () => undefined) {
  const stop = new AbortController(), active = AbortSignal.any([signal, stop.signal, AbortSignal.timeout(15_000)]);
  const media = response.headers.get("x-mira-audio-stream") === "mp3"
    && typeof MediaSource !== "undefined" && MediaSource.isTypeSupported(MP3) ? new MediaSource() : null;
  let url: string | null = null;
  const opened = media ? event(media, "sourceopen", active) : null;
  // An abort before the first read must not leave a rejected event promise.
  void opened?.catch(() => undefined);
  if (media) { url = window.URL.createObjectURL(media); audio.src = url; }
  const done = (async () => {
    if (!response.body) throw Error("Voice returned no audio");
    const reader = response.body.getReader(), chunks: Uint8Array<ArrayBuffer>[] = [];
    const cancel = () => { void reader.cancel().catch(() => undefined); };
    active.addEventListener("abort", cancel, { once: true });
    let size = 0;
    try {
      active.throwIfAborted();
      let buffer: SourceBuffer | null = null;
      if (media) { await opened; active.throwIfAborted(); buffer = media.addSourceBuffer(MP3); }
      for (;;) {
        const { done, value } = await reader.read(); active.throwIfAborted();
        if (done) break;
        size += value.length;
        if (size > LIMIT) throw Error("Voice audio exceeds limit");
        const bytes = new Uint8Array(value); chunks.push(bytes);
        if (buffer) {
          const appended = event(buffer, "updateend", active);
          // Ensure a synchronous append error also cleans the pending listener.
          try { buffer.appendBuffer(bytes); } catch (cause) { stop.abort(cause); await appended.catch(() => undefined); throw cause; }
          await appended;
          onBuffer(new Blob(chunks, { type: MP3 }));
        }
      }
      if (!size) throw Error("Voice returned empty audio");
      const blob = new Blob(chunks, { type: response.headers.get("content-type") ?? MP3 });
      if (media) { active.throwIfAborted(); media.endOfStream(); }
      else { active.throwIfAborted(); url = window.URL.createObjectURL(blob); audio.src = url; onBuffer(blob); }
      return blob;
    } finally { active.removeEventListener("abort", cancel); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  })();
  return {
    streaming: !!media,
    done,
    dispose() { stop.abort(new DOMException("Speech canceled", "AbortError")); if (url) window.URL.revokeObjectURL(url); url = null; },
  };
}
