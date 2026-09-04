import { assertEdgeSameOrigin, EdgeRequestError, edgeError, edgeJson, edgeRateLimited, readEdgeJson } from "@/lib/edge-security";
import type { SpeechLanguage } from "@/lib/speech";

const MODEL = "@cf/openai/whisper-large-v3-turbo";

function transcriptionText(result: unknown) {
  if (!result || typeof result !== "object") return "";
  const record = result as Record<string, unknown>;
  if (typeof record.text === "string") return record.text.trim();
  const response = record.response;
  if (response && typeof response === "object" && typeof (response as Record<string, unknown>).text === "string") return ((response as Record<string, unknown>).text as string).trim();
  return "";
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const respond = (body: unknown, status = 200, details: Record<string, unknown> = {}) => edgeJson(requestId, "companion-transcribe", startedAt, body, status, details);
  try {
    assertEdgeSameOrigin(request);
    if (await edgeRateLimited(request, "companion-transcribe", 24)) return respond({ error: "Voice transcription is cooling down." }, 429, { limited: true });
    const body = await readEdgeJson(request, 6_000_000) as { audioBase64?: unknown; contentType?: unknown; language?: unknown } | null;
    const audioBase64 = typeof body?.audioBase64 === "string" ? body.audioBase64 : "";
    const contentType = typeof body?.contentType === "string" ? body.contentType.slice(0, 80) : "audio/webm";
    if (!/^audio\/(?:webm|wav|mpeg|mp4|ogg)/i.test(contentType) || !/^[a-z\d+/=]+$/i.test(audioBase64) || audioBase64.length < 80) {
      return respond({ error: "A supported voice recording is required." }, 400);
    }
    const language = body?.language === "en" || body?.language === "hi" || body?.language === "hinglish" ? body.language as SpeechLanguage : "auto";
    const { env } = await import(/* webpackIgnore: true */ "cloudflare:workers");
    const result = await env.AI.run(MODEL as never, {
      audio: audioBase64,
      task: "transcribe",
      vad_filter: true,
      condition_on_previous_text: false,
      no_speech_threshold: .65,
      initial_prompt: "Natural one-person conversation. The speaker may switch between English, Hindi, and Roman-script Hinglish. Preserve the language actually spoken.",
      ...(language === "en" ? { language: "en" } : language === "hi" ? { language: "hi" } : {}),
    } as never);
    const text = transcriptionText(result);
    if (!text) return respond({ error: "I couldn’t hear clear speech in that recording." }, 422, { model: MODEL });
    return respond({ text, language: /[\u0900-\u097f]/u.test(text) ? "hi" : "auto" }, 200, { model: MODEL });
  } catch (cause) {
    console.error("Companion transcription failed", cause instanceof Error ? cause.message : "unknown");
    if (cause instanceof EdgeRequestError) return edgeError(requestId, "companion-transcribe", startedAt, cause);
    return respond({ error: "Voice transcription is temporarily unavailable." }, 503, { model: MODEL });
  }
}
