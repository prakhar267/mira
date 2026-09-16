import { detectCompanionLanguage } from "@/lib/companion-prompt";
import { assertEdgeSameOrigin, EdgeRequestError, edgeError, edgeJson, edgeRateLimited, readEdgeJson } from "@/lib/edge-security";
import { createInworldTranscriptionRequest, INWORLD_STT_ENDPOINT, INWORLD_STT_MODEL, isUsableInworldTranscript, preserveSpokenLanguage, readInworldTranscript } from "@/lib/inworld-transcription";
import { withProviderDeadline } from "@/lib/provider-resilience";
import { withInferenceCapacity } from "@/lib/capacity";
import { authorizeInference } from "@/lib/inference-policy";
import { parseTranscriptionPayload } from "@/lib/inference-payloads";
import { providerFetch } from "@/lib/provider-fetch";
import { discardUnusedRequestBody } from "@/lib/unused-request-body";

const CLOUDFLARE_MODEL = "@cf/openai/whisper-large-v3-turbo";

function readTranscript(result: unknown) {
  if (!result || typeof result !== "object") return "";
  const record = result as Record<string, unknown>;
  if (typeof record.text === "string") return record.text.trim();
  const response = record.response;
  if (response && typeof response === "object" && typeof (response as Record<string, unknown>).text === "string") {
    return ((response as Record<string, unknown>).text as string).trim();
  }
  const results = record.results && typeof record.results === "object" ? record.results as Record<string, unknown> : {};
  const channels = Array.isArray(results.channels) ? results.channels : [];
  const channel = channels[0] && typeof channels[0] === "object" ? channels[0] as Record<string, unknown> : {};
  const alternatives = Array.isArray(channel.alternatives) ? channel.alternatives : [];
  const alternative = alternatives[0] && typeof alternatives[0] === "object" ? alternatives[0] as Record<string, unknown> : {};
  return typeof alternative.transcript === "string" ? alternative.transcript.trim() : "";
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const respond = (body: unknown, status = 200, details: Record<string, unknown> = {}) => edgeJson(requestId, "companion-transcribe", startedAt, body, status, details);
  try {
    assertEdgeSameOrigin(request);
    const principal = await authorizeInference(request, "transcribe");
    if (await edgeRateLimited(request, "companion-transcribe", 30)) return respond({ error: "Voice input thoda cool down kar raha hai. Ek moment mein try karo." }, 429, { limited: true });
    const { audioBase64, contentType } = parseTranscriptionPayload(await readEdgeJson(request, 4_005_000));
    const estimatedSeconds = Math.max(1, Math.ceil(audioBase64.length * .75 / 12000));

    const { env } = await import(/* webpackIgnore: true */ "cloudflare:workers");
    const apiKey = (env as typeof env & { INWORLD_API_KEY?: string }).INWORLD_API_KEY?.trim();
    if (apiKey) {
      try {
        const text = await withInferenceCapacity("transcribe", principal, estimatedSeconds, () => withProviderDeadline("inworld-transcribe",async signal=>{
        await authorizeInference(request, "transcribe");
        signal.throwIfAborted();
        const response = await providerFetch(INWORLD_STT_ENDPOINT, {
          ...createInworldTranscriptionRequest(audioBase64, contentType, apiKey),
          signal,
        });
        if (!response.ok) throw new Error(`Inworld transcription returned ${response.status}.`);
        return preserveSpokenLanguage(readInworldTranscript(await response.json()));
        },4000,request.signal));
        await authorizeInference(request, "transcribe");
        request.signal.throwIfAborted();
        if (isUsableInworldTranscript(text)) {
          const language = detectCompanionLanguage(text);
          return respond({ text, language }, 200, { provider: "inworld", model: INWORLD_STT_MODEL, language });
        }
        return respond({ error: "Main clearly sun nahi paayi. Please ek baar phir bolo." }, 422, { provider: "inworld", model: INWORLD_STT_MODEL, filtered: text ? "hallucination" : "no-speech" });
      } catch (cause) {
        if (cause instanceof EdgeRequestError || request.signal.aborted) throw cause;
        console.warn(JSON.stringify({ event: "provider_fallback", requestId, route: "companion-transcribe" }));
      }
    }

    await authorizeInference(request, "transcribe");
    const result = await withInferenceCapacity("transcribe", principal, estimatedSeconds, () => withProviderDeadline("cloudflare",async signal=>{
      await authorizeInference(request, "transcribe"); signal.throwIfAborted(); return env.AI.run(CLOUDFLARE_MODEL as never, {
      audio: audioBase64,
      task: "transcribe",
      vad_filter: true,
      condition_on_previous_text: false,
      no_speech_threshold: .62,
      initial_prompt: "Natural Indian conversation that may switch between English, Hindi in Devanagari, and Roman-script Hinglish. Preserve the speaker's actual language, English words, and names.",
    } as never); },2500,request.signal));
    await authorizeInference(request, "transcribe");
    request.signal.throwIfAborted();
    const text = preserveSpokenLanguage(readTranscript(result));
    if (!isUsableInworldTranscript(text)) return respond({ error: "Main clearly sun nahi paayi. Please ek baar phir bolo." }, 422, { provider: "cloudflare", model: CLOUDFLARE_MODEL });
    const language = detectCompanionLanguage(text);
    return respond({ text, language }, 200, { provider: "cloudflare", model: CLOUDFLARE_MODEL, language });
  } catch (cause) {
    console.error(JSON.stringify({ event: "provider_failure", requestId, route: "companion-transcribe" }));
    if (cause instanceof EdgeRequestError) return edgeError(requestId, "companion-transcribe", startedAt, cause);
    return respond({ error: "Voice input abhi connect nahi ho paaya. Please phir try karo." }, 503, { provider: "unavailable", model: `${INWORLD_STT_MODEL},${CLOUDFLARE_MODEL}` });
  } finally {
    await discardUnusedRequestBody(request);
  }
}
