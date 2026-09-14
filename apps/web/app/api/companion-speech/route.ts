import { createInworldSpeechRequest, decodeInworldAudio, fitInworldSpeechPrompt, INWORLD_TTS_ENDPOINT } from "@/lib/inworld-speech";
import { assertEdgeSameOrigin, EdgeRequestError, edgeError, edgeJson, edgeRateLimited, readEdgeJson, recordServiceMetric } from "@/lib/edge-security";
import { withProviderDeadline } from "@/lib/provider-resilience";
import { withInferenceCapacity } from "@/lib/capacity";
import { authorizeInference } from "@/lib/inference-policy";
import { parseSpeechPayload } from "@/lib/inference-payloads";
import { unsafeCompanionOutput } from "@/lib/companion-safety";
import { providerFetch } from "@/lib/provider-fetch";
import { discardUnusedRequestBody } from "@/lib/unused-request-body";

const VOICE = {
  model: "inworld-tts-2-flash",
  name: "Priya",
  provider: "inworld",
  language: "hinglish",
} as const;

async function generateInworldSpeech(prompt: string, apiKey: string, requestSignal: AbortSignal) {
  return withProviderDeadline("inworld-speech", async (signal) => {
  const response = await providerFetch(INWORLD_TTS_ENDPOINT, {...createInworldSpeechRequest(prompt, apiKey),signal});
  if (!response.ok) throw new Error(`Inworld generation returned ${response.status}.`);
  const body = await response.json() as { audioContent?: unknown };
  if (typeof body.audioContent !== "string") throw new Error("Inworld returned no audio.");
  return decodeInworldAudio(body.audioContent);
  },10000,requestSignal);
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
    const principal = await authorizeInference(request, "speech");
    if (await edgeRateLimited(request, "companion-speech", 36)) return respond({ error: "Voice thoda cool down kar raha hai. Ek moment mein try karo." }, 429, { limited: true });
    const prompt = fitInworldSpeechPrompt(parseSpeechPayload(await readEdgeJson(request, 5_000)));
    if (!prompt) return respond({ error: "Speech text is required." }, 400);
    if (unsafeCompanionOutput(prompt)) throw new EdgeRequestError("This speech request could not be delivered safely.", 422, "UNSAFE_SPEECH");

    const { env } = await import(/* webpackIgnore: true */ "cloudflare:workers");
    const apiKey = (env as typeof env & { INWORLD_API_KEY?: string }).INWORLD_API_KEY?.trim();
    if (!apiKey) return respond({ error: "Mira's selected Priya voice is not configured yet." }, 503, { provider: VOICE.provider, model: VOICE.model, configuration: "missing" });
    const audio = await withInferenceCapacity("speech", principal, prompt.length, async () => {
      await authorizeInference(request, "speech");
      return generateInworldSpeech(prompt, apiKey, request.signal);
    });
    await authorizeInference(request, "speech");
    request.signal.throwIfAborted();
    recordServiceMetric("companion-speech",false,Date.now()-startedAt);
    return audioResponse(audio, requestId, startedAt);
  } catch (cause) {
    console.error(JSON.stringify({ event: "provider_failure", requestId, route: "companion-speech" }));
    if (cause instanceof EdgeRequestError) return edgeError(requestId, "companion-speech", startedAt, cause);
    return respond({ error: "Mira ki voice abhi connect nahi ho paayi. Please phir try karo." }, 503, { provider: VOICE.provider, model: VOICE.model });
  } finally {
    await discardUnusedRequestBody(request);
  }
}
