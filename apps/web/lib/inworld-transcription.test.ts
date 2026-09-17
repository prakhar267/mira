import { describe, expect, it } from "vitest";
import { createInworldTranscriptionRequest, hasUnsupportedSpeechScript, INWORLD_STT_MODEL, isUsableInworldTranscript, normalizeSpokenHinglish, preserveSpokenLanguage, readInworldTranscript } from "./inworld-transcription";

describe("Inworld transcription", () => {
  it("rejects unsupported-script misdetections without altering valid names or numbers", () => {
    for(const text of ["คุณ", "混。", "你好。", "คุณ คุณ คุณ Pune"]) {
      expect(hasUnsupportedSpeechScript(text)).toBe(true);expect(isUsableInworldTranscript(text)).toBe(false);
    }
    for(const text of ["One.", "Honey.", "Pune", "पुणे", "José", "café", "हाँ 👍", "My friend Νίκος is here", "The symbol is α", "คุณ คุณ Pune"]) expect(hasUnsupportedSpeechScript(text)).toBe(false);
    const config=JSON.parse(String(createInworldTranscriptionRequest("YWJj","audio/mpeg","secret",["पुणे"],"hi").body)).transcribeConfig;
    expect(config).toMatchObject({language:"hi",prompts:["पुणे"]});
  });
  it("sends bounded caller vocabulary as soft terms without forcing language or replacing the result", () => {
    const request = createInworldTranscriptionRequest("YWJj", "audio/mpeg", "secret", ["Pune", "पुणे", "Anika"]);
    const config = JSON.parse(String(request.body)).transcribeConfig;
    expect(config.prompts).toEqual(["Pune", "पुणे", "Anika"]);
    expect(config).not.toHaveProperty("language");
    expect(preserveSpokenLanguage("One.")).toBe("One.");
  });
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
    expect(isUsableInworldTranscript("Mira and Priya are my friends.")).toBe(true);
    expect(isUsableInworldTranscript("Mira aur Priya mere dost hain.")).toBe(true);
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
  it("recognizes Latin English words inside Hindi speech without changing Latin names", () => {
    const mixed=preserveSpokenLanguage("यार, आज office में काफी stress था. Boss ने meeting में डाद दिया.");
    expect(mixed).not.toMatch(/\p{Script=Devanagari}/u);
    expect(mixed).toContain("office");expect(mixed).toContain("Boss");
    expect(preserveSpokenLanguage("Neha ने office में काम किया।")).toContain("Neha ");
    expect(preserveSpokenLanguage("मेरी दोस्त Neha कल Pune आ रही है।")).toBe("मेरी दोस्त Neha कल Pune आ रही है।");
    expect(preserveSpokenLanguage("I work with Neha.")).toBe("I work with Neha.");
  });
});
