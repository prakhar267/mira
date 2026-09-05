import { createInworldSpeechRequest, decodeInworldAudio, fitInworldSpeechPrompt, INWORLD_TTS_ENDPOINT } from "@/lib/inworld-speech";
import { assertEdgeSameOrigin, EdgeRequestError, edgeError, edgeJson, edgeRateLimited, readEdgeJson } from "@/lib/edge-security";

const VOICE = {
  model: "inworld-tts-2",
  name: "Priya",
  provider: "inworld",
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

async function generateInworldSpeech(prompt: string, apiKey: string, requestSignal: AbortSignal) {
  const response = await fetchWithDeadline(INWORLD_TTS_ENDPOINT, createInworldSpeechRequest(prompt, apiKey), 45_000, requestSignal);
  if (!response.ok) throw new Error(`Inworld generation returned ${response.status}.`);
  const body = await response.json() as { audioContent?: unknown };
  if (typeof body.audioContent !== "string") throw new Error("Inworld returned no audio.");
  return decodeInworldAudio(body.audioContent);
}

function audioResponse(audio: Uint8Array, requestId: string, startedAt: number) {
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
      "content-type": "audio/mpeg",
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
    const prompt = fitInworldSpeechPrompt(typeof body?.text === "string" ? body.text : "");
    if (!prompt) return respond({ error: "Speech text is required." }, 400);

    const { env } = await import(/* webpackIgnore: true */ "cloudflare:workers");
    const apiKey = (env as typeof env & { INWORLD_API_KEY?: string }).INWORLD_API_KEY?.trim();
    if (!apiKey) return respond({ error: "Mira's selected Priya voice is not configured yet." }, 503, { provider: VOICE.provider, model: VOICE.model, configuration: "missing" });

    let audio: Uint8Array | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        audio = await generateInworldSpeech(prompt, apiKey, request.signal);
        break;
      } catch (cause) {
        if (attempt === 1 || request.signal.aborted) throw cause;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    if (!audio) throw new Error("Inworld returned no audio.");
    return audioResponse(audio, requestId, startedAt);
  } catch (cause) {
    console.error("Mira Inworld speech failed", cause instanceof Error ? cause.message : "unknown");
    if (cause instanceof EdgeRequestError) return edgeError(requestId, "companion-speech", startedAt, cause);
    return respond({ error: "Mira ki voice abhi connect nahi ho paayi. Please phir try karo." }, 503, { provider: VOICE.provider, model: VOICE.model });
  }
}
