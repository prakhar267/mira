import { describe, expect, it } from "vitest";
import { createInworldTranscriptionRequest, INWORLD_STT_MODEL, isUsableInworldTranscript, normalizeSpokenHinglish, preserveSpokenLanguage, readInworldTranscript } from "./inworld-transcription";

describe("Inworld transcription", () => {
  it("lets the model auto-detect English, Hindi, or Hinglish", () => {
    const request = createInworldTranscriptionRequest("YWJj", "audio/webm;codecs=opus", "Basic secret");
    expect(request.headers).toEqual({ authorization: "Basic secret", "content-type": "application/json" });
    expect(JSON.parse(String(request.body))).toMatchObject({
      transcribeConfig: { modelId: INWORLD_STT_MODEL, audioEncoding: "AUTO_DETECT" },
      audioData: { content: "YWJj" },
    });
    expect(JSON.parse(String(request.body)).transcribeConfig).not.toHaveProperty("prompts");
    expect(JSON.parse(String(request.body)).transcribeConfig).not.toHaveProperty("language");
  });

  it("uses explicit encodings and safely reads transcripts", () => {
    expect(JSON.parse(String(createInworldTranscriptionRequest("YWJj", "audio/mpeg", "secret").body))).toMatchObject({ transcribeConfig: { audioEncoding: "MP3" } });
    expect(readInworldTranscript({ transcription: { transcript: "  aaj work hectic tha  " } })).toBe("aaj work hectic tha");
    expect(readInworldTranscript({ error: "bad response" })).toBe("");
  });

  it("rejects leaked recognition hints while keeping real Hinglish", () => {
    expect(isUsableInworldTranscript("Expected terms: Natural Indian Hinglish conversation, Mira, Priya.")).toBe(false);
    expect(isUsableInworldTranscript("Hindi and English code switching, Mira")).toBe(false);
    expect(isUsableInworldTranscript("I'm not sure what you're talking about.")).toBe(true);
    expect(isUsableInworldTranscript("Ah.")).toBe(false);
    expect(isUsableInworldTranscript("Yaar aaj work bahut hectic tha")).toBe(true);
    expect(isUsableInworldTranscript("आज काम बहुत मुश्किल था")).toBe(true);
  });

  it.each(["yes", "No!", "okay", "thanks", "thank you", "Hindi", "English", "Hinglish", "haan", "nahi", "kya?", "shukriya", "हाँ", "नहीं", "हिंदी", "अंग्रेज़ी", "क्यों?", "शुक्रिया", "Prakhar", "Pune", "Tuesday", "पुणे", "42", "४२"])("preserves a meaningful short reply: %s", text => {
    expect(isUsableInworldTranscript(text)).toBe(true);
  });

  it.each(["", "...", "Ah.", "uh", "thanks for watching", "please subscribe"])("keeps empty, filler and known hallucination rejection: %s", text => {
    expect(isUsableInworldTranscript(text)).toBe(false);
  });

  it("keeps Hindi script but romanizes clearly code-mixed speech", () => {
    expect(preserveSpokenLanguage("आज काम बहुत मुश्किल था।")).toBe("आज काम बहुत मुश्किल था।");
    expect(preserveSpokenLanguage("यार मेरी मैनेजर ने अपनी मिस्टेक के लिए मुझे ब्लेम कर दिया।")).toBe("yaar meri manager ne apni mistake ke liye mujhe blame kar diya.");
    expect(normalizeSpokenHinglish("kyaa main usane yah boloon")).toBe("kya main usne yah bolun");
  });
});
