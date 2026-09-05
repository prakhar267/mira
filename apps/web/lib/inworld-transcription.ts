export const INWORLD_STT_ENDPOINT = "https://api.inworld.ai/stt/v1/transcribe";
export const INWORLD_STT_MODEL = "inworld/inworld-stt-1";

function audioEncoding(contentType: string) {
  if (/audio\/(?:mpeg|mp3)/i.test(contentType)) return "MP3";
  if (/audio\/ogg/i.test(contentType)) return "OGG_OPUS";
  if (/audio\/(?:wav|wave|x-wav)/i.test(contentType)) return "AUTO_DETECT";
  return "AUTO_DETECT";
}

export function createInworldTranscriptionRequest(audioBase64: string, contentType: string, apiKey: string): RequestInit {
  return {
    method: "POST",
    headers: {
      authorization: `Basic ${apiKey.replace(/^Basic\s+/i, "")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      transcribeConfig: {
        modelId: INWORLD_STT_MODEL,
        audioEncoding: audioEncoding(contentType),
        language: "en",
      },
      audioData: { content: audioBase64 },
    }),
  };
}

export function isUsableInworldTranscript(value: string) {
  const normalized = value.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  if (normalized.split(" ").length < 2) return false;
  if (normalized.startsWith("expected terms")) return false;
  if (/^i (?:m|am) not sure what you(?: re| are) talking about$/.test(normalized)) return false;
  if (/^(?:thank you|thanks for watching|please subscribe)$/.test(normalized)) return false;
  const leakedHints = ["natural indian hinglish conversation", "hindi and english code switching", "mira", "priya"]
    .filter((hint) => normalized.includes(hint));
  return leakedHints.length < 2;
}

export function readInworldTranscript(result: unknown) {
  if (!result || typeof result !== "object") return "";
  const transcription = (result as Record<string, unknown>).transcription;
  if (!transcription || typeof transcription !== "object") return "";
  const transcript = (transcription as Record<string, unknown>).transcript;
  return typeof transcript === "string" ? transcript.trim() : "";
}
