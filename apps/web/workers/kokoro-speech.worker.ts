import type { SpeechLanguage } from "@/lib/speech";

type GenerateRequest = {
  type: "generate";
  id: number;
  text: string;
  language: Exclude<SpeechLanguage, "auto">;
  speed: number;
};

type CancelRequest = { type: "cancel"; id: number };

type WorkerResponse =
  | { type: "generated"; id: number; blob: Blob }
  | { type: "error"; id: number; message: string };

// Rolldown currently folds Transformers.js' `typeof window` worker guard into
// a direct `window.document` lookup in production builds. Give that lookup a
// harmless worker-local value before the dynamically imported model executes.
// `document` intentionally remains absent, so Transformers.js still selects
// its Web Worker runtime rather than its browser-window runtime.
const workerScope = self as typeof self & { window?: { document?: undefined } };
if (!("window" in workerScope)) {
  Object.defineProperty(workerScope, "window", {
    configurable: true,
    value: {},
  });
}

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const HUGGING_FACE_MODEL_PREFIX = `https://huggingface.co/${MODEL_ID}/resolve/main/`;
const MODEL_PROXY_PREFIX = new URL(`/api/voice-model/${MODEL_ID}/resolve/main/`, self.location.origin).href;
const ORT_MJS_URL = new URL(
  "../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.mjs",
  import.meta.url,
).href;
const ORT_WASM_URL = new URL(
  "../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm",
  import.meta.url,
).href;
const nativeFetch = fetch.bind(self);
Object.defineProperty(workerScope, "fetch", {
  configurable: true,
  value: async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestedUrl = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
    const effectiveInput = requestedUrl.startsWith(HUGGING_FACE_MODEL_PREFIX)
      ? `${MODEL_PROXY_PREFIX}${requestedUrl.slice(HUGGING_FACE_MODEL_PREFIX.length)}`
      : input;
    let response: Response;
    try {
      response = await nativeFetch(effectiveInput, init);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "network request failed";
      throw new Error(`Voice asset fetch failed: ${requestedUrl} (${detail})`);
    }
    if (/text\/html/i.test(response.headers.get("content-type") ?? "")) {
      const redirectedTo = response.url && response.url !== requestedUrl
        ? ` → ${response.url}`
        : "";
      throw new Error(`Voice asset returned HTML (${response.status}): ${requestedUrl}${redirectedTo}`);
    }
    return response;
  },
});

type AudioResult = { toBlob(): Promise<Blob> };
type TokenizerResult = { input_ids: unknown };
type KokoroInstance = {
  tokenizer(text: string, options: { truncation: boolean }): TokenizerResult;
  generate(text: string, options: { voice: string; speed: number }): Promise<AudioResult>;
  generate_from_ids(inputIds: unknown, options: { voice: string; speed: number }): Promise<AudioResult>;
  _validate_voice(voice: string): string;
};

const MODEL_CACHE_MARKER = "Kokoro-82M-v1.0-ONNX";
const VOICE_ID = "hf_alpha";
const canceled = new Set<number>();
let modelPromise: Promise<KokoroInstance> | null = null;
let hindiPhonemizerPromise: Promise<Awaited<ReturnType<typeof import("ephone")["default"]>>> | null = null;
let generationQueue = Promise.resolve();

async function removeCorruptModelCacheEntries() {
  if (typeof caches === "undefined") return;

  for (const cacheName of ["transformers-cache", "kokoro-voices"]) {
    let cache: Cache;
    try {
      cache = await caches.open(cacheName);
    } catch {
      continue;
    }

    const requests = await cache.keys();
    await Promise.all(requests.map(async (request) => {
      if (!request.url.includes(MODEL_CACHE_MARKER)) return;

      // Older builds first requested `/models/<repo>/...` from the app origin.
      // The SPA fallback returned index.html with HTTP 200 and Transformers
      // cached it as model data. Its cache lookup checks that local key before
      // the Hugging Face URL even when local models are now disabled.
      const isObsoleteLocalModel = new URL(request.url).pathname.includes(`/models/${MODEL_ID}/`);
      const response = await cache.match(request);
      const isHtml = /text\/html/i.test(response?.headers.get("content-type") ?? "");
      if (isObsoleteLocalModel || isHtml) await cache.delete(request);
    }));
  }
}

async function model() {
  if (!modelPromise) {
    modelPromise = Promise.all([
      import("kokoro-js"),
      import("@huggingface/transformers"),
    ]).then(async ([{ KokoroTTS }, { env }]) => {
      // Some production bundlers cannot reliably identify a dedicated worker
      // and otherwise try `/models/...` on the app origin. That returns the
      // HTML app shell, which then fails JSON parsing. Force Hub-only loading.
      env.allowLocalModels = false;
      env.allowRemoteModels = true;
      env.remoteHost = new URL("/api/voice-model/", self.location.origin).href;
      env.remotePathTemplate = "{model}/resolve/{revision}";
      env.useBrowserCache = typeof caches !== "undefined";
      const onnxWasm = env.backends.onnx.wasm;
      if (!onnxWasm) throw new Error("The browser voice runtime is unavailable.");
      onnxWasm.wasmPaths = { mjs: ORT_MJS_URL, wasm: ORT_WASM_URL };
      onnxWasm.numThreads = 1;
      await removeCorruptModelCacheEntries();
      const instance = await KokoroTTS.from_pretrained(MODEL_ID, {
        device: "wasm",
        dtype: "q8",
      }) as unknown as KokoroInstance;
      // kokoro-js 1.2 exposes only its English catalog even though the official
      // multilingual model contains the Hindi voice pack. The model API accepts
      // that official voice once the catalog-only validator is widened.
      instance._validate_voice = (voice) => voice.at(0) ?? "h";
      return instance;
    }).catch((cause) => {
      modelPromise = null;
      throw cause;
    });
  }
  return modelPromise;
}

async function hindiPhonemizer() {
  if (!hindiPhonemizerPromise) {
    hindiPhonemizerPromise = import("ephone").then(async ({ default: createEphone, all }) => {
      const instance = await createEphone(all);
      instance.setVoice("hi");
      return instance;
    }).catch((cause) => {
      hindiPhonemizerPromise = null;
      throw cause;
    });
  }
  return hindiPhonemizerPromise;
}

async function generate(request: GenerateRequest) {
  const tts = await model();
  let audio: AudioResult;
  if (request.language === "en") {
    audio = await tts.generate(request.text, { voice: VOICE_ID, speed: request.speed });
  } else {
    const phonemizer = await hindiPhonemizer();
    phonemizer.setVoice("hi");
    const phonemes = phonemizer.textToIpa(request.text).trim();
    if (!phonemes) throw new Error("The multilingual phonemizer returned no speech.");
    const { input_ids } = tts.tokenizer(phonemes, { truncation: true });
    audio = await tts.generate_from_ids(input_ids, { voice: VOICE_ID, speed: request.speed });
  }
  return audio.toBlob();
}

self.addEventListener("message", (event: MessageEvent<GenerateRequest | CancelRequest>) => {
  const request = event.data;
  if (request.type === "cancel") {
    canceled.add(request.id);
    return;
  }

  generationQueue = generationQueue.then(async () => {
    try {
      const blob = await generate(request);
      if (canceled.delete(request.id)) return;
      self.postMessage({ type: "generated", id: request.id, blob } satisfies WorkerResponse);
    } catch (cause) {
      if (canceled.delete(request.id)) return;
      self.postMessage({
        type: "error",
        id: request.id,
        message: cause instanceof Error ? cause.message : "Open-source voice generation failed.",
      } satisfies WorkerResponse);
    }
  });
});
