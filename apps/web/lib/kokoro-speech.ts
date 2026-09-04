import type { SpeechLanguage } from "./speech";

type WorkerResponse =
  | { type: "generated"; id: number; blob: Blob }
  | { type: "error"; id: number; message: string };

interface PendingGeneration {
  resolve(blob: Blob): void;
  reject(cause: unknown): void;
  signal?: AbortSignal;
  abort?: () => void;
}

let speechWorker: Worker | null = null;
let nextRequestId = 0;
const pending = new Map<number, PendingGeneration>();

function rejectAll(cause: unknown) {
  for (const request of pending.values()) {
    if (request.signal && request.abort) request.signal.removeEventListener("abort", request.abort);
    request.reject(cause);
  }
  pending.clear();
}

function worker() {
  if (speechWorker) return speechWorker;
  if (typeof Worker === "undefined") throw new Error("This browser cannot run the local neural voice.");
  const created = new Worker(new URL("../workers/kokoro-speech.worker.ts", import.meta.url), { type: "module" });
  created.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
    const response = event.data;
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    if (request.signal && request.abort) request.signal.removeEventListener("abort", request.abort);
    if (response.type === "generated") request.resolve(response.blob);
    else request.reject(new Error(response.message));
  });
  created.addEventListener("error", () => {
    rejectAll(new Error("The local neural voice could not start in this browser."));
    created.terminate();
    if (speechWorker === created) speechWorker = null;
  });
  speechWorker = created;
  return created;
}

export function generateCompanionSpeech(
  text: string,
  options: {
    language: Exclude<SpeechLanguage, "auto">;
    speed: number;
    signal?: AbortSignal;
  },
) {
  if (options.signal?.aborted) return Promise.reject(new DOMException("Speech canceled.", "AbortError"));
  const id = ++nextRequestId;
  const created = worker();
  return new Promise<Blob>((resolve, reject) => {
    const request: PendingGeneration = {
      resolve,
      reject,
      ...(options.signal ? { signal: options.signal } : {}),
    };
    if (options.signal) {
      request.abort = () => {
        pending.delete(id);
        created.postMessage({ type: "cancel", id });
        reject(new DOMException("Speech canceled.", "AbortError"));
      };
      options.signal.addEventListener("abort", request.abort, { once: true });
    }
    pending.set(id, request);
    created.postMessage({
      type: "generate",
      id,
      text,
      language: options.language,
      speed: options.speed,
    });
  });
}
