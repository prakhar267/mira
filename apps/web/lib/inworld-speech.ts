const MAX_INWORLD_SPEECH_CHARACTERS = 500;
const PRIYA_DIRECTION = "[speak warmly and naturally, like a close friend in a relaxed private conversation]";

export const INWORLD_TTS_ENDPOINT = "https://api.inworld.ai/tts/v1/voice";

export function fitInworldSpeechPrompt(value: string) {
  const clean = value
    .replace(/<[^>]{0,100}>/g, " ")
    .replace(/[\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= MAX_INWORLD_SPEECH_CHARACTERS) return clean;
  const clipped = clean.slice(0, MAX_INWORLD_SPEECH_CHARACTERS);
  const sentenceEnd = Math.max(clipped.lastIndexOf("."), clipped.lastIndexOf("!"), clipped.lastIndexOf("?"), clipped.lastIndexOf("।"));
  const wordEnd = clipped.lastIndexOf(" ");
  const end = sentenceEnd >= 260 ? sentenceEnd + 1 : wordEnd >= 260 ? wordEnd : MAX_INWORLD_SPEECH_CHARACTERS;
  return clipped.slice(0, end).replace(/[,:;\s]+$/, "").trim();
}

export function createInworldSpeechRequest(text: string, apiKey: string): RequestInit {
  return {
    method: "POST",
    headers: {
      authorization: `Basic ${apiKey.replace(/^Basic\s+/i, "")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      text: `${PRIYA_DIRECTION} ${text}`,
      voiceId: "Priya",
      modelId: "inworld-tts-2",
      audioConfig: {
        audioEncoding: "MP3",
        sampleRateHertz: 48_000,
        bitRate: 128_000,
      },
      deliveryMode: "BALANCED",
      timestampType: "TIMESTAMP_TYPE_UNSPECIFIED",
      applyTextNormalization: "ON",
    }),
  };
}

export function decodeInworldAudio(value: string) {
  if (!/^[a-z\d+/]+={0,2}$/i.test(value) || value.length > 11_000_000) throw new Error("Inworld returned invalid audio data.");
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const mp3 = (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33)
    || (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0);
  if (!mp3 || bytes.length > 8_000_000) throw new Error("Inworld returned invalid audio data.");
  return bytes;
}
