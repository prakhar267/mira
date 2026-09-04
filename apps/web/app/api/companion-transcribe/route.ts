import { assertEdgeSameOrigin, EdgeRequestError, edgeError, edgeJson, edgeRateLimited, readEdgeJson } from "@/lib/edge-security";
import { detectSpeechLanguage, romanizeHindiForEnglishTts, type SpeechLanguage } from "@/lib/speech";

const MODEL = "@cf/deepgram/nova-3";
const FALLBACK_MODEL = "@cf/openai/whisper-large-v3-turbo";

function decodedAudio(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function transcriptionResult(result: unknown) {
  if (!result || typeof result !== "object") return { text: "", language: "" };
  const record = result as Record<string, unknown>;
  if (typeof record.text === "string") return { text: record.text.trim(), language: "" };
  const response = record.response;
  if (response && typeof response === "object" && typeof (response as Record<string, unknown>).text === "string") {
    return { text: ((response as Record<string, unknown>).text as string).trim(), language: "" };
  }
  const results = record.results && typeof record.results === "object" ? record.results as Record<string, unknown> : {};
  const channels = Array.isArray(results.channels) ? results.channels : [];
  const channel = channels[0] && typeof channels[0] === "object" ? channels[0] as Record<string, unknown> : {};
  const alternatives = Array.isArray(channel.alternatives) ? channel.alternatives : [];
  const alternative = alternatives[0] && typeof alternatives[0] === "object" ? alternatives[0] as Record<string, unknown> : {};
  return {
    text: typeof alternative.transcript === "string" ? alternative.transcript.trim() : "",
    language: typeof channel.detected_language === "string" ? channel.detected_language : typeof results.detected_language === "string" ? results.detected_language : "",
  };
}

function normalizeTranscript(text: string, requested: SpeechLanguage) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  if (requested === "hinglish") return romanizeHindiForEnglishTts(clean);
  if (requested === "auto" && /\p{Script=Devanagari}/u.test(clean) && /[a-z]{2,}/i.test(clean)) {
    return romanizeHindiForEnglishTts(clean);
  }
  return clean;
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
    const runWhisper = (forcedLanguage = language) => env.AI.run(FALLBACK_MODEL as never, {
      audio: audioBase64,
      task: "transcribe",
      vad_filter: true,
      condition_on_previous_text: false,
      no_speech_threshold: .65,
      initial_prompt: "Natural one-person conversation. The speaker may switch between English, Hindi, and Roman-script Hinglish. Preserve names and the language actually spoken.",
      ...(forcedLanguage === "en" ? { language: "en" } : forcedLanguage === "hi" ? { language: "hi" } : {}),
    } as never);
    let result: unknown;
    let model = MODEL;
    try {
      result = await env.AI.run(MODEL as never, {
        audio: { body: decodedAudio(audioBase64), contentType },
        language: language === "en" ? "en-IN" : language === "hi" ? "hi" : "multi",
        detect_language: true,
        smart_format: true,
        punctuate: true,
        filler_words: false,
        mip_opt_out: true,
      } as never);
    } catch (error) {
      console.warn("Nova-3 transcription failed; using Whisper fallback", error instanceof Error ? error.message : "unknown");
      model = FALLBACK_MODEL;
      result = await runWhisper();
    }
    let transcription = transcriptionResult(result);
    if (!transcription.text && model === MODEL) {
      model = FALLBACK_MODEL;
      transcription = transcriptionResult(await runWhisper());
    }
    let normalizationLanguage = language;
    if (/\p{Script=Arabic}/u.test(transcription.text)) {
      const wasCodeMixed = /[a-z]{2,}/i.test(transcription.text);
      transcription = transcriptionResult(await runWhisper(language === "en" ? "en" : "hi"));
      model = FALLBACK_MODEL;
      if (language === "auto" && wasCodeMixed) normalizationLanguage = "hinglish";
    }
    const text = normalizeTranscript(transcription.text, normalizationLanguage);
    if (!text) return respond({ error: "I couldn’t hear clear speech in that recording." }, 422, { model: MODEL });
    const detectedLanguage = detectSpeechLanguage(text);
    return respond({ text, language: detectedLanguage, detectedLanguage: transcription.language || detectedLanguage }, 200, { model });
  } catch (cause) {
    console.error("Companion transcription failed", cause instanceof Error ? cause.message : "unknown");
    if (cause instanceof EdgeRequestError) return edgeError(requestId, "companion-transcribe", startedAt, cause);
    return respond({ error: "Voice transcription is temporarily unavailable." }, 503, { model: `${MODEL}+${FALLBACK_MODEL}` });
  }
}
