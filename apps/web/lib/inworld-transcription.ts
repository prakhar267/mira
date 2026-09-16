import { romanizeHindiForEnglishTts } from "./speech";

export const INWORLD_STT_ENDPOINT = "https://api.inworld.ai/stt/v1/transcribe";
export const INWORLD_STT_MODEL = "inworld/inworld-stt-1";

const devanagariCodeMixPattern = /(?:ऑफिस|वर्क|जॉब|बॉस|मैनेजर|मीटिंग|इंटरव्यू|डिनर|मैसेज|टेक्स्ट|कॉल|वीडियो|ब्लेम|मूड|वीकेंड|प्रोजेक्ट|डेडलाइन|प्रेज़ेंटेशन|ईमेल|रिप्लाई|कॉन्टेक्स्ट)/u;
const spokenHinglishCorrections: Record<string, string> = {
  apanee: "apni",
  apane: "apne",
  apanaa: "apna",
  blem: "blame",
  boloon: "bolun",
  diyaa: "diya",
  galatee: "galti",
  kyaa: "kya",
  kahe: "keh",
  karoon: "karun",
  lie: "liye",
  mainejar: "manager",
  mainne: "maine",
  meree: "meri",
  mistek: "mistake",
  mujhee: "mujhe",
  rahee: "rahi",
  saamane: "saamne",
  usane: "usne",
};

export function normalizeSpokenHinglish(value: string) {
  return value.replace(/[\p{L}]+/gu, (word) => spokenHinglishCorrections[word.toLowerCase()] ?? word);
}

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
      },
      audioData: { content: audioBase64 },
    }),
  };
}

export function isUsableInworldTranscript(value: string) {
  const normalized = value.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  if (!/[\p{L}\p{N}]/u.test(normalized)) return false;
  // A brief answer still carries intent. Call VAD already checks for sustained
  // speech; do not silently discard agreement, rejection or a language choice.
  // Names, places, dates and numbers are also valid one-word answers. A fixed
  // acknowledgement allowlist would still lose answers such as "Pune" or "42".
  if (/^(?:ah+|uh+|um+|erm+|er+|आह|उम्म)$/iu.test(normalized)) return false;
  if (normalized.startsWith("expected terms")) return false;
  if (/^(?:thanks for watching|please subscribe)$/.test(normalized)) return false;
  const leakedHints = ["natural indian hinglish conversation", "hindi and english code switching", "mira", "priya"]
    .filter((hint) => normalized.includes(hint));
  // Two people's names are ordinary speech, not evidence of leaked prompts.
  const hasPromptHint = leakedHints.some(hint => hint !== "mira" && hint !== "priya");
  return !hasPromptHint || leakedHints.length < 2;
}

export function readInworldTranscript(result: unknown) {
  if (!result || typeof result !== "object") return "";
  const transcription = (result as Record<string, unknown>).transcription;
  if (!transcription || typeof transcription !== "object") return "";
  const transcript = (transcription as Record<string, unknown>).transcript;
  return typeof transcript === "string" ? transcript.trim() : "";
}

/** Speech has no script; romanize auto-detected Hindi only when the transcript contains clear English code-mixing. */
export function preserveSpokenLanguage(value: string) {
  const clean = value.replace(/\s+/g, " ").trim();
  if (/\p{Script=Devanagari}/u.test(clean) && devanagariCodeMixPattern.test(clean)) return normalizeSpokenHinglish(romanizeHindiForEnglishTts(clean));
  return clean;
}
