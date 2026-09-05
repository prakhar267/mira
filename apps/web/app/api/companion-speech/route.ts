import { normalizeHinglishText } from "@/lib/speech";
import { assertEdgeSameOrigin, EdgeRequestError, edgeError, edgeJson, edgeRateLimited, readEdgeJson } from "@/lib/edge-security";

const VOICE = {
  model: "@cf/myshell-ai/melotts",
  name: "Mira",
  provider: "cloudflare-melotts",
  contentType: "audio/wav",
} as const;

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function detectedAudioType(bytes: Uint8Array, declared: string) {
  if (bytes.length >= 4 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return "audio/wav";
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return "audio/mpeg";
  return declared;
}

function audioResponse(audio: BodyInit, contentType: string, requestId: string, startedAt: number) {
  console.log(JSON.stringify({ event: "edge_request", requestId, route: "companion-speech", status: 200, latencyMs: Date.now() - startedAt, provider: VOICE.provider, model: VOICE.model, language: "hinglish" }));
  return new Response(audio, {
    headers: {
      "cache-control": "no-store",
      "content-type": /^audio\//i.test(contentType) ? contentType : VOICE.contentType,
      "x-companion-voice": VOICE.name,
      "x-companion-voice-model": VOICE.model,
      "x-companion-language": "hinglish",
      "x-content-type-options": "nosniff",
      "x-request-id": requestId,
    },
  });
}

async function normalizeSpeechResult(result: unknown, requestId: string, startedAt: number) {
  if (result instanceof Response) {
    if (!result.ok || !result.body) throw new Error(`Voice model returned ${result.status}.`);
    return audioResponse(result.body, result.headers.get("content-type") ?? VOICE.contentType, requestId, startedAt);
  }
  if (result instanceof ReadableStream) return audioResponse(result, VOICE.contentType, requestId, startedAt);
  if (result instanceof ArrayBuffer) return audioResponse(result, VOICE.contentType, requestId, startedAt);
  if (ArrayBuffer.isView(result)) return audioResponse(result as unknown as BodyInit, VOICE.contentType, requestId, startedAt);

  const payload = result && typeof result === "object" ? result as Record<string, unknown> : {};
  const nested = payload.result && typeof payload.result === "object" ? payload.result as Record<string, unknown> : {};
  const audio = typeof nested.audio === "string" ? nested.audio : typeof payload.audio === "string" ? payload.audio : "";
  const contentType = typeof nested.content_type === "string" ? nested.content_type : typeof payload.content_type === "string" ? payload.content_type : VOICE.contentType;
  if (!audio) throw new Error("Voice model returned no audio.");
  const dataMatch = audio.match(/^data:([^;,]+);base64,(.+)$/s);
  const bytes = decodeBase64(dataMatch?.[2] ?? audio);
  return audioResponse(bytes, detectedAudioType(bytes, dataMatch?.[1] ?? contentType), requestId, startedAt);
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const respond = (body: unknown, status = 200, details: Record<string, unknown> = {}) => edgeJson(requestId, "companion-speech", startedAt, body, status, details);
  try {
    assertEdgeSameOrigin(request);
    if (await edgeRateLimited(request, "companion-speech", 45)) return respond({ error: "Voice thoda cool down kar raha hai. Ek moment mein try karo." }, 429, { limited: true });
    const body = await readEdgeJson(request, 5_000) as { text?: unknown } | null;
    const prompt = normalizeHinglishText(typeof body?.text === "string" ? body.text.slice(0, 900) : "");
    if (!prompt) return respond({ error: "Speech text is required." }, 400);

    const { env } = await import(/* webpackIgnore: true */ "cloudflare:workers");
    let result: unknown;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        result = await env.AI.run(VOICE.model as never, { prompt, lang: "en" } as never);
        break;
      } catch (cause) {
        if (attempt === 3) throw cause;
        await new Promise((resolve) => setTimeout(resolve, 120 * (attempt + 1)));
      }
    }
    if (result === undefined) throw new Error("Voice model returned no result.");
    return await normalizeSpeechResult(result, requestId, startedAt);
  } catch (cause) {
    console.error("Mira Hinglish speech failed", cause instanceof Error ? cause.message : "unknown");
    if (cause instanceof EdgeRequestError) return edgeError(requestId, "companion-speech", startedAt, cause);
    return respond({ error: "Mira ki voice abhi connect nahi ho paayi. Please phir try karo." }, 503, { provider: VOICE.provider, model: VOICE.model });
  }
}
