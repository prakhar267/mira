import { detectSpeechLanguage, romanizeHindiForEnglishTts, type SpeechLanguage } from "@/lib/speech";
import { assertEdgeSameOrigin, EdgeRequestError, edgeError, edgeJson, edgeRateLimited, readEdgeJson } from "@/lib/edge-security";

const PRIMARY_VOICE = {
  model: "@cf/myshell-ai/melotts",
  voice: "melo-female",
  provider: "cloudflare-melotts",
  contentType: "audio/wav",
} as const;
const FAILOVER_VOICE = {
  model: "@cf/deepgram/aura-1",
  voice: "luna",
  provider: "cloudflare-aura-1",
  contentType: "audio/mpeg",
} as const;
type VoiceSource = typeof PRIMARY_VOICE | typeof FAILOVER_VOICE;

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function detectedAudioContentType(bytes: Uint8Array, declared: string) {
  if (bytes.length >= 4 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return "audio/wav";
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return "audio/mpeg";
  return declared;
}

function audioResponse(audio: BodyInit, contentType: string, requestId: string, startedAt: number, language: string, source: VoiceSource) {
  console.log(JSON.stringify({ event: "edge_request", requestId, route: "companion-speech", status: 200, latencyMs: Date.now() - startedAt, provider: source.provider, model: source.model, voice: source.voice, language }));
  return new Response(audio, {
    headers: {
      "cache-control": "no-store",
      "content-type": /^audio\//i.test(contentType) ? contentType : "audio/mpeg",
      "x-companion-voice": source.voice,
      "x-companion-voice-model": source.model,
      "x-companion-voice-provider": source.provider,
      "x-companion-language": language,
      "x-content-type-options": "nosniff",
      "x-request-id": requestId,
    },
  });
}

async function normalizeSpeechResult(result: unknown, requestId: string, startedAt: number, language: string, source: VoiceSource) {
  if (result instanceof Response) {
    if (!result.ok || !result.body) throw new Error(`${source.model} returned ${result.status}.`);
    return audioResponse(result.body, result.headers.get("content-type") ?? source.contentType, requestId, startedAt, language, source);
  }
  // Cloudflare's current MeloTTS binding returns RIFF/WAV bytes even though the
  // catalog schema also documents an MP3 response variant.
  if (result instanceof ReadableStream) return audioResponse(result, source.contentType, requestId, startedAt, language, source);
  if (result instanceof ArrayBuffer) return audioResponse(result, source.contentType, requestId, startedAt, language, source);
  if (ArrayBuffer.isView(result)) return audioResponse(result as unknown as BodyInit, source.contentType, requestId, startedAt, language, source);

  const payload = result && typeof result === "object" ? result as Record<string, unknown> : {};
  const nested = payload.result && typeof payload.result === "object" ? payload.result as Record<string, unknown> : {};
  const audio = typeof nested.audio === "string" ? nested.audio : typeof payload.audio === "string" ? payload.audio : "";
  const contentType = typeof nested.content_type === "string" ? nested.content_type : typeof payload.content_type === "string" ? payload.content_type : source.contentType;
  if (!audio) throw new Error(`${source.model} returned no audio.`);

  if (/^https:\/\//i.test(audio)) {
    const upstream = await fetch(audio);
    if (!upstream.ok || !upstream.body) throw new Error(`${source.model} audio fetch returned ${upstream.status}.`);
    return audioResponse(upstream.body, upstream.headers.get("content-type") ?? contentType, requestId, startedAt, language, source);
  }

  const dataMatch = audio.match(/^data:([^;,]+);base64,(.+)$/s);
  const bytes = decodeBase64(dataMatch?.[2] ?? audio);
  return audioResponse(bytes, detectedAudioContentType(bytes, dataMatch?.[1] ?? contentType), requestId, startedAt, language, source);
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
    const requestedLanguage = body?.language === "en" || body?.language === "hi" || body?.language === "hinglish" ? body.language : "auto";
    if (!text) return respond({ error: "Speech text is required." }, 400);

    const language = detectSpeechLanguage(text, requestedLanguage as SpeechLanguage);
    // MeloTTS has a consistent female English voice but no native Hindi model.
    // Romanizing Devanagari keeps the same voice identity for Hindi and mixed turns
    // without adding another paid provider or changing the visible chat reply.
    const prompt = language === "hi" ? romanizeHindiForEnglishTts(text) : text;
    const { env } = await import(/* webpackIgnore: true */ "cloudflare:workers");
    let result: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        result = await env.AI.run(PRIMARY_VOICE.model, { prompt, lang: "en" });
        break;
      } catch (error) {
        // MeloTTS occasionally emits transient 3043 provider errors. Brief
        // retries prevent calls from going silent without masking quota or
        // validation failures.
        if (!(error instanceof Error) || !/\b3043\b/.test(error.message)) throw error;
        if (attempt === 2) break;
        await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
      }
    }
    if (result !== undefined) return await normalizeSpeechResult(result, requestId, startedAt, language, PRIMARY_VOICE);

    console.warn("MeloTTS remained unavailable after retries; using Cloudflare Aura failover.");
    const failover = await env.AI.run(FAILOVER_VOICE.model as never, {
      text: prompt,
      speaker: FAILOVER_VOICE.voice,
      encoding: "mp3",
    } as never);
    return await normalizeSpeechResult(failover, requestId, startedAt, language, FAILOVER_VOICE);
  } catch (error) {
    console.error("Cloudflare MeloTTS speech failed", error instanceof Error ? error.message : "unknown error");
    if (error instanceof EdgeRequestError) return edgeError(requestId, "companion-speech", startedAt, error);
    return respond({ error: "The free Cloudflare voice is temporarily unavailable." }, 503, {
      provider: `${PRIMARY_VOICE.provider}+${FAILOVER_VOICE.provider}`,
      model: `${PRIMARY_VOICE.model}+${FAILOVER_VOICE.model}`,
    });
  }
}
