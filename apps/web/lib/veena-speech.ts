const MAX_VEENA_SPEECH_CHARACTERS = 500;
export const VEENA_ENDPOINT = "https://api.segmind.com/v1/veena-tts";

export function createVeenaRequest(text: string, apiKey: string): RequestInit {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      text,
      speaker: "kavya",
      temperature: 0.4,
      top_p: 0.9,
      repetition_penalty: 1.05,
    }),
  };
}

export function fitVeenaSpeechPrompt(value: string) {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= MAX_VEENA_SPEECH_CHARACTERS) return clean;
  const clipped = clean.slice(0, MAX_VEENA_SPEECH_CHARACTERS);
  const sentenceEnd = Math.max(clipped.lastIndexOf("."), clipped.lastIndexOf("!"), clipped.lastIndexOf("?"), clipped.lastIndexOf("।"));
  const wordEnd = clipped.lastIndexOf(" ");
  const end = sentenceEnd >= 260 ? sentenceEnd + 1 : wordEnd >= 260 ? wordEnd : MAX_VEENA_SPEECH_CHARACTERS;
  return clipped.slice(0, end).replace(/[,:;\s]+$/, "").trim();
}

export function detectVeenaAudioContentType(bytes: Uint8Array) {
  if (bytes.length < 12) return null;
  const wave = bytes.length > 44
    && bytes[0] === 0x52
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x46
    && bytes[8] === 0x57
    && bytes[9] === 0x41
    && bytes[10] === 0x56
    && bytes[11] === 0x45;
  const mp3 = (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33)
    || (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0);
  const ogg = bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53;
  if (wave) return "audio/wav";
  if (mp3) return "audio/mpeg";
  if (ogg) return "audio/ogg";
  return null;
}
