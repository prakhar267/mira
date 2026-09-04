import { cloudSpeakerForVoice, detectSpeechLanguage, synthesisLanguageCode, type SpeechLanguage } from "@/lib/speech";
import { companionVoiceMode } from "@/lib/voice-profiles";
import { assertEdgeSameOrigin, EdgeRequestError, edgeError, edgeJson, edgeRateLimited, readEdgeJson } from "@/lib/edge-security";

const MODEL = "@cf/deepgram/aura-2-en";
const SARVAM_ENDPOINT = "https://api.sarvam.ai/text-to-speech";
function audioResponse(audio: BodyInit, provider: "sarvam-bulbul-v3" | "cloudflare-aura-2", requestId: string, startedAt: number) {
  console.log(JSON.stringify({ event: "edge_request", requestId, route: "companion-speech", status: 200, latencyMs: Date.now() - startedAt, provider }));
  return new Response(audio, {
    headers: {
      "cache-control": "no-store",
      "content-type": "audio/mpeg",
      "x-companion-voice": provider === "sarvam-bulbul-v3" ? "priya" : "juno",
      "x-companion-voice-provider": provider,
      "x-content-type-options": "nosniff",
      "x-request-id": requestId,
    },
  });
}

async function synthesizeWithSarvam(apiKey: string, text: string, voiceId: string, language: SpeechLanguage, requestId: string, startedAt: number) {
  const mode = companionVoiceMode(voiceId);
  const response = await fetch(SARVAM_ENDPOINT, {
    method: "POST",
    headers: {
      "api-subscription-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      text,
      language_code: synthesisLanguageCode(text, language),
      speaker: "priya",
      pace: mode.rate,
      speech_sample_rate: 24_000,
      model: "bulbul:v3",
      output_audio_codec: "mp3",
      temperature: mode.temperature,
    }),
  });
  if (!response.ok) throw new Error(`Sarvam speech returned ${response.status}.`);
  const payload = await response.json() as { audios?: unknown };
  const encoded = Array.isArray(payload.audios) && typeof payload.audios[0] === "string" ? payload.audios[0] : "";
  if (!encoded) throw new Error("Sarvam speech returned no audio.");
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return audioResponse(bytes, "sarvam-bulbul-v3", requestId, startedAt);
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const respond = (body: unknown, status = 200, details: Record<string, unknown> = {}) => edgeJson(requestId, "companion-speech", startedAt, body, status, details);
  try {
    assertEdgeSameOrigin(request);
    if (await edgeRateLimited(request, "companion-speech", 40)) return respond({ error: "Please wait a moment before playing more speech." }, 429, { limited: true });
    const body = await readEdgeJson(request, 5_000) as { text?: unknown; voiceId?: unknown; language?: unknown } | null;
    const text = typeof body?.text === "string" ? body.text.trim().slice(0, 900) : "";
    const voiceId = typeof body?.voiceId === "string" ? body.voiceId.slice(0, 80) : "mira-natural-01";
    const language = body?.language === "en" || body?.language === "hi" || body?.language === "hinglish" ? body.language : "auto";
    if (!text) return respond({ error: "Speech text is required." }, 400);
    const { env } = await import(/* webpackIgnore: true */ "cloudflare:workers");
    if (env.SARVAM_API_KEY) {
      try {
        return await synthesizeWithSarvam(env.SARVAM_API_KEY, text, voiceId, language, requestId, startedAt);
      } catch (error) {
        console.error("Sarvam companion speech failed", error instanceof Error ? error.message : "unknown error");
      }
    }
    const resolvedLanguage = detectSpeechLanguage(text, language);
    if (resolvedLanguage !== "en") {
      return edgeJson(requestId, "companion-speech", startedAt,
        { error: "Use the device's native Hindi voice for this turn.", fallback: "browser" },
        422,
        { provider: "browser-native" },
        { "x-companion-voice-provider": "browser-native" },
      );
    }
    const audio = await env.AI.run(MODEL as never, {
      text,
      speaker: cloudSpeakerForVoice(voiceId),
      encoding: "mp3",
    } as never);
    if (!(audio instanceof ReadableStream)) return respond({ error: "Speech audio was unavailable." }, 503);
    return audioResponse(audio, "cloudflare-aura-2", requestId, startedAt);
  } catch (error) {
    console.error("Companion speech failed", error instanceof Error ? error.message : "unknown error");
    if (error instanceof EdgeRequestError) return edgeError(requestId, "companion-speech", startedAt, error);
    return respond({ error: "Speech audio was unavailable." }, 503);
  }
}
