import { createVeenaRequest, detectVeenaAudioContentType, fitVeenaSpeechPrompt, VEENA_ENDPOINT } from "@/lib/veena-speech";
import { assertEdgeSameOrigin, EdgeRequestError, edgeError, edgeJson, edgeRateLimited, readEdgeJson } from "@/lib/edge-security";

const VOICE = {
  model: "maya-research/Veena",
  name: "Kavya",
  provider: "segmind",
  speaker: "kavya",
  language: "hinglish",
} as const;

async function fetchWithDeadline(input: string, init: RequestInit, timeoutMs: number, requestSignal: AbortSignal) {
  const controller = new AbortController();
  const abortFromRequest = () => controller.abort(requestSignal.reason);
  requestSignal.addEventListener("abort", abortFromRequest, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("Voice generation timed out.")), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    requestSignal.removeEventListener("abort", abortFromRequest);
  }
}

async function generateVeenaSpeech(prompt: string, apiKey: string, requestSignal: AbortSignal) {
  const response = await fetchWithDeadline(VEENA_ENDPOINT, createVeenaRequest(prompt, apiKey), 90_000, requestSignal);

  if (!response.ok) throw new Error(`Veena generation returned ${response.status}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const contentType = detectVeenaAudioContentType(bytes);
  if (!contentType || bytes.length > 8_000_000) {
    throw new Error("Veena returned invalid audio data.");
  }
  return { bytes, contentType };
}

function audioResponse(audio: Uint8Array, contentType: string, requestId: string, startedAt: number) {
  console.log(JSON.stringify({
    event: "edge_request",
    requestId,
    route: "companion-speech",
    status: 200,
    latencyMs: Date.now() - startedAt,
    provider: VOICE.provider,
    model: VOICE.model,
    voice: VOICE.name,
    language: VOICE.language,
  }));
  return new Response(audio as unknown as BodyInit, {
    headers: {
      "cache-control": "no-store",
      "content-type": contentType,
      "x-companion-voice": VOICE.name,
      "x-companion-voice-model": VOICE.model,
      "x-companion-voice-provider": VOICE.provider,
      "x-companion-language": VOICE.language,
      "x-content-type-options": "nosniff",
      "x-request-id": requestId,
    },
  });
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const respond = (body: unknown, status = 200, details: Record<string, unknown> = {}) => edgeJson(requestId, "companion-speech", startedAt, body, status, details);
  try {
    assertEdgeSameOrigin(request);
    if (await edgeRateLimited(request, "companion-speech", 36)) return respond({ error: "Voice thoda cool down kar raha hai. Ek moment mein try karo." }, 429, { limited: true });
    const body = await readEdgeJson(request, 5_000) as { text?: unknown } | null;
    const prompt = fitVeenaSpeechPrompt(typeof body?.text === "string" ? body.text : "");
    if (!prompt) return respond({ error: "Speech text is required." }, 400);

    const { env } = await import(/* webpackIgnore: true */ "cloudflare:workers");
    const apiKey = (env as typeof env & { SEGMIND_API_KEY?: string }).SEGMIND_API_KEY?.trim();
    if (!apiKey) return respond({ error: "Mira's selected Kavya voice is not configured yet." }, 503, { provider: VOICE.provider, model: VOICE.model, configuration: "missing" });

    let audio: Awaited<ReturnType<typeof generateVeenaSpeech>> | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        audio = await generateVeenaSpeech(prompt, apiKey, request.signal);
        break;
      } catch (cause) {
        if (attempt === 1 || request.signal.aborted) throw cause;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    if (!audio) throw new Error("Veena returned no audio.");
    return audioResponse(audio.bytes, audio.contentType, requestId, startedAt);
  } catch (cause) {
    console.error("Mira Veena speech failed", cause instanceof Error ? cause.message : "unknown");
    if (cause instanceof EdgeRequestError) return edgeError(requestId, "companion-speech", startedAt, cause);
    return respond({ error: "Mira ki voice abhi connect nahi ho paayi. Please phir try karo." }, 503, { provider: VOICE.provider, model: VOICE.model });
  }
}
