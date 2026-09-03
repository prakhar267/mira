import { cloudSpeakerForVoice, synthesisLanguageCode, type SpeechLanguage } from "@/lib/speech";
import { companionVoiceMode } from "@/lib/voice-profiles";

const MODEL = "@cf/deepgram/aura-2-en";
const SARVAM_ENDPOINT = "https://api.sarvam.ai/text-to-speech";
const windowMs = 60_000;
const requestWindows = new Map<string, { count: number; startedAt: number }>();

function rateLimited(request: Request) {
  const key = request.headers.get("cf-connecting-ip") ?? "local";
  const now = Date.now();
  const current = requestWindows.get(key);
  if (!current || now - current.startedAt >= windowMs) {
    requestWindows.set(key, { count: 1, startedAt: now });
    return false;
  }
  current.count += 1;
  return current.count > 40;
}

function audioResponse(audio: BodyInit, provider: "sarvam-bulbul-v3" | "cloudflare-aura-2") {
  return new Response(audio, {
    headers: {
      "cache-control": "no-store",
      "content-type": "audio/mpeg",
      "x-companion-voice": provider === "sarvam-bulbul-v3" ? "priya" : "juno",
      "x-companion-voice-provider": provider,
      "x-content-type-options": "nosniff",
    },
  });
}

async function synthesizeWithSarvam(apiKey: string, text: string, voiceId: string, language: SpeechLanguage) {
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
  return audioResponse(bytes, "sarvam-bulbul-v3");
}

export async function POST(request: Request) {
  if (rateLimited(request)) return Response.json({ error: "Please wait a moment before playing more speech." }, { status: 429 });
  const body = await request.json().catch(() => null) as { text?: unknown; voiceId?: unknown; language?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim().slice(0, 900) : "";
  const voiceId = typeof body?.voiceId === "string" ? body.voiceId.slice(0, 80) : "mira-natural-01";
  const language = body?.language === "en" || body?.language === "hi" || body?.language === "hinglish"
    ? body.language
    : "auto";
  if (!text) return Response.json({ error: "Speech text is required." }, { status: 400 });

  try {
    const { env } = await import(/* webpackIgnore: true */ "cloudflare:workers");
    if (env.SARVAM_API_KEY) {
      try {
        return await synthesizeWithSarvam(env.SARVAM_API_KEY, text, voiceId, language);
      } catch (error) {
        console.error("Sarvam companion speech failed", error instanceof Error ? error.message : "unknown error");
      }
    }
    const audio = await env.AI.run(MODEL as never, {
      text,
      speaker: cloudSpeakerForVoice(voiceId),
      encoding: "mp3",
    } as never);
    if (!(audio instanceof ReadableStream)) return Response.json({ error: "Speech audio was unavailable." }, { status: 503 });
    return audioResponse(audio, "cloudflare-aura-2");
  } catch (error) {
    console.error("Companion speech failed", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "Speech audio was unavailable." }, { status: 503 });
  }
}
