import { detectSpeechLanguage, romanizeHindiForEnglishTts, type SpeechLanguage } from "@/lib/speech";
import { assertEdgeSameOrigin, EdgeRequestError, edgeError, edgeJson, edgeRateLimited, readEdgeJson } from "@/lib/edge-security";

const MODEL = "@cf/myshell-ai/melotts";
const VOICE = "melo-female";
const PROVIDER = "cloudflare-melotts";

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

function audioResponse(audio: BodyInit, contentType: string, requestId: string, startedAt: number, language: string) {
  console.log(JSON.stringify({ event: "edge_request", requestId, route: "companion-speech", status: 200, latencyMs: Date.now() - startedAt, provider: PROVIDER, model: MODEL, voice: VOICE, language }));
  return new Response(audio, {
    headers: {
      "cache-control": "no-store",
      "content-type": /^audio\//i.test(contentType) ? contentType : "audio/mpeg",
      "x-companion-voice": VOICE,
      "x-companion-voice-model": MODEL,
      "x-companion-voice-provider": PROVIDER,
      "x-companion-language": language,
      "x-content-type-options": "nosniff",
      "x-request-id": requestId,
    },
  });
}

async function normalizeSpeechResult(result: unknown, requestId: string, startedAt: number, language: string) {
  if (result instanceof Response) {
    if (!result.ok || !result.body) throw new Error(`MeloTTS returned ${result.status}.`);
    return audioResponse(result.body, result.headers.get("content-type") ?? "audio/mpeg", requestId, startedAt, language);
  }
  // Cloudflare's current MeloTTS binding returns RIFF/WAV bytes even though the
  // catalog schema also documents an MP3 response variant.
  if (result instanceof ReadableStream) return audioResponse(result, "audio/wav", requestId, startedAt, language);
  if (result instanceof ArrayBuffer) return audioResponse(result, "audio/wav", requestId, startedAt, language);
  if (ArrayBuffer.isView(result)) return audioResponse(result as unknown as BodyInit, "audio/wav", requestId, startedAt, language);

  const payload = result && typeof result === "object" ? result as Record<string, unknown> : {};
  const nested = payload.result && typeof payload.result === "object" ? payload.result as Record<string, unknown> : {};
  const audio = typeof nested.audio === "string" ? nested.audio : typeof payload.audio === "string" ? payload.audio : "";
  const contentType = typeof nested.content_type === "string" ? nested.content_type : typeof payload.content_type === "string" ? payload.content_type : "audio/mpeg";
  if (!audio) throw new Error("MeloTTS returned no audio.");

  if (/^https:\/\//i.test(audio)) {
    const upstream = await fetch(audio);
    if (!upstream.ok || !upstream.body) throw new Error(`MeloTTS audio fetch returned ${upstream.status}.`);
    return audioResponse(upstream.body, upstream.headers.get("content-type") ?? contentType, requestId, startedAt, language);
  }

  const dataMatch = audio.match(/^data:([^;,]+);base64,(.+)$/s);
  const bytes = decodeBase64(dataMatch?.[2] ?? audio);
  return audioResponse(bytes, detectedAudioContentType(bytes, dataMatch?.[1] ?? contentType), requestId, startedAt, language);
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
        result = await env.AI.run(MODEL, { prompt, lang: "en" });
        break;
      } catch (error) {
        // MeloTTS occasionally emits transient 3043 provider errors. Brief
        // retries prevent calls from going silent without masking quota or
        // validation failures.
        if (!(error instanceof Error) || !/\b3043\b/.test(error.message) || attempt === 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
      }
    }
    return await normalizeSpeechResult(result, requestId, startedAt, language);
  } catch (error) {
    console.error("Cloudflare MeloTTS speech failed", error instanceof Error ? error.message : "unknown error");
    if (error instanceof EdgeRequestError) return edgeError(requestId, "companion-speech", startedAt, error);
    return respond({ error: "The free Cloudflare voice is temporarily unavailable." }, 503, { provider: PROVIDER, model: MODEL, voice: VOICE });
  }
}
