import { synthesisLanguageCode, type SpeechLanguage } from "@/lib/speech";
import { companionVoiceMode } from "@/lib/voice-profiles";
import { assertEdgeSameOrigin, EdgeRequestError, edgeError, edgeJson, edgeRateLimited, readEdgeJson } from "@/lib/edge-security";

const MODEL = "xai/grok-tts";
const VOICE = "ara";

function styledSpeech(text: string, voiceId: string) {
  const emotion = companionVoiceMode(voiceId).emotion;
  if (emotion === "happy") return `<higher-pitch>${text}</higher-pitch>`;
  if (emotion === "playful") return `<sing-song>${text}</sing-song>`;
  if (emotion === "tender") return `<soft>${text}</soft>`;
  if (emotion === "intimate") return `<soft><slow>${text}</slow></soft>`;
  if (emotion === "sad") return `<soft><lower-pitch><slow>${text}</slow></lower-pitch></soft>`;
  if (emotion === "angry") return `<emphasis>${text}</emphasis>`;
  return text;
}

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function audioResponse(audio: BodyInit, contentType: string, requestId: string, startedAt: number, language: string) {
  console.log(JSON.stringify({ event: "edge_request", requestId, route: "companion-speech", status: 200, latencyMs: Date.now() - startedAt, provider: "xai-grok-tts", model: MODEL, voice: VOICE, language }));
  return new Response(audio, {
    headers: {
      "cache-control": "no-store",
      "content-type": /^audio\//i.test(contentType) ? contentType : "audio/mpeg",
      "x-companion-voice": VOICE,
      "x-companion-voice-model": MODEL,
      "x-companion-voice-provider": "xai-grok-tts",
      "x-companion-language": language,
      "x-content-type-options": "nosniff",
      "x-request-id": requestId,
    },
  });
}

async function normalizeSpeechResult(result: unknown, requestId: string, startedAt: number, language: string) {
  if (result instanceof ReadableStream) return audioResponse(result, "audio/mpeg", requestId, startedAt, language);
  if (result instanceof ArrayBuffer) return audioResponse(result, "audio/mpeg", requestId, startedAt, language);
  if (ArrayBuffer.isView(result)) return audioResponse(result as unknown as BodyInit, "audio/mpeg", requestId, startedAt, language);

  const payload = result && typeof result === "object" ? result as Record<string, unknown> : {};
  const nested = payload.result && typeof payload.result === "object" ? payload.result as Record<string, unknown> : {};
  const audio = typeof nested.audio === "string" ? nested.audio : typeof payload.audio === "string" ? payload.audio : "";
  const contentType = typeof nested.content_type === "string" ? nested.content_type : typeof payload.content_type === "string" ? payload.content_type : "audio/mpeg";
  if (!audio) throw new Error("Grok TTS returned no audio.");

  if (/^https:\/\//i.test(audio)) {
    const upstream = await fetch(audio);
    if (!upstream.ok || !upstream.body) throw new Error(`Grok TTS audio fetch returned ${upstream.status}.`);
    return audioResponse(upstream.body, upstream.headers.get("content-type") ?? contentType, requestId, startedAt, language);
  }

  const dataMatch = audio.match(/^data:([^;,]+);base64,(.+)$/s);
  return audioResponse(decodeBase64(dataMatch?.[2] ?? audio), dataMatch?.[1] ?? contentType, requestId, startedAt, language);
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
    const requestedLanguage = body?.language === "en" || body?.language === "hi" || body?.language === "hinglish" ? body.language : "auto";
    if (!text) return respond({ error: "Speech text is required." }, 400);

    const language = synthesisLanguageCode(text, requestedLanguage as SpeechLanguage);
    const { env } = await import(/* webpackIgnore: true */ "cloudflare:workers");
    const result = await env.AI.run(MODEL, {
      text: styledSpeech(text, voiceId),
      voice_id: VOICE,
      language,
      output_format: {
        codec: "mp3",
        sample_rate: 24_000,
        bit_rate: 128_000,
      },
    });
    return await normalizeSpeechResult(result, requestId, startedAt, language);
  } catch (error) {
    console.error("Ara companion speech failed", error instanceof Error ? error.message : "unknown error");
    if (error instanceof EdgeRequestError) return edgeError(requestId, "companion-speech", startedAt, error);
    return respond({ error: "Ara voice is temporarily unavailable." }, 503, { provider: "xai-grok-tts", model: MODEL, voice: VOICE });
  }
}
