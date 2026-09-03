import { describe, expect, it } from "vitest";
import { cloudSpeakerForVoice, collectRecognitionTranscript, detectSpeechLanguage, recognitionLocale, selectPreferredVoice, splitMultilingualSpeechSegments, splitSpeechSegments, synthesisLanguageCode } from "./speech";

describe("companion speech", () => {
  it("detects English, Hindi, and Roman-script Hinglish", () => {
    expect(detectSpeechLanguage("That meeting was endless")).toBe("en");
    expect(detectSpeechLanguage("आज मेरा मन ठीक नहीं है")).toBe("hi");
    expect(detectSpeechLanguage("yaar aaj mood bilkul off hai")).toBe("hinglish");
  });

  it("uses Indian recognition locales for Hindi and Hinglish", () => {
    expect(recognitionLocale("hi")).toBe("hi-IN");
    expect(recognitionLocale("hinglish")).toBe("en-IN");
  });

  it("normalizes English, Hindi, and Hinglish for the multilingual neural voice", () => {
    expect(synthesisLanguageCode("Tell me about your day")).toBe("en-IN");
    expect(synthesisLanguageCode("आज तुम कैसी हो?")).toBe("hi-IN");
    expect(synthesisLanguageCode("yaar aaj tum bahut cute lag rahi ho")).toBe("hi-IN");
    expect(synthesisLanguageCode("A number like 10,000", "hinglish")).toBe("hi-IN");
  });

  it("never selects the removed Lekha voice", () => {
    const voices = [
      { name: "Alex", lang: "en-US", default: true },
      { name: "Lekha Enhanced", lang: "hi-IN", default: false },
      { name: "Google हिन्दी Female", lang: "hi-IN", default: false },
    ];
    expect(selectPreferredVoice(voices, "आज कैसा दिन था", "mira-warm-01")?.name).toBe("Google हिन्दी Female");
  });

  it("uses the best available feminine fallback for each supported language", () => {
    const voices = [
      { name: "Samantha", lang: "en-US", default: true },
      { name: "Tessa", lang: "en-ZA", default: false },
      { name: "Karen", lang: "en-AU", default: false },
      { name: "Flo (English (US))", lang: "en-US", default: false },
      { name: "Tara", lang: "en-IN", default: false },
      { name: "Aman", lang: "en-IN", default: false },
      { name: "Lekha", lang: "hi-IN", default: false },
      { name: "Google हिन्दी Female", lang: "hi-IN", default: false },
    ];

    expect(selectPreferredVoice(voices, "Tell me something fun", "mira-playful-01", "en")?.name).toBe("Tara");
    expect(selectPreferredVoice(voices, "Stay close to me", "mira-intimate-01", "en")?.name).toBe("Tara");
    expect(selectPreferredVoice(voices, "Be direct with me", "mira-angry-01", "en")?.name).toBe("Tara");
    expect(selectPreferredVoice(voices, "I need some confidence", "mira-happy-01", "en")?.name).toBe("Tara");
    expect(selectPreferredVoice(voices, "yaar aaj mood off hai", "mira-natural-01", "hinglish")?.name).toBe("Tara");
    expect(selectPreferredVoice(voices, "आज कैसा दिन था", "mira-natural-01", "hi")?.name).toBe("Google हिन्दी Female");
  });

  it("accumulates final and interim recognition segments without repeating earlier words", () => {
    const segments = new Map<number, string>();
    const first = collectRecognitionTranscript(segments, {
      resultIndex: 0,
      results: Object.assign([
        Object.assign([{ transcript: "I was telling you", confidence: .94 }], { isFinal: true }),
        Object.assign([{ transcript: "about my day", confidence: .61 }], { isFinal: false }),
      ], {}),
    });
    expect(first).toEqual({ text: "I was telling you about my day", hasFinalResult: true });

    const second = collectRecognitionTranscript(segments, {
      resultIndex: 1,
      results: Object.assign([
        Object.assign([{ transcript: "I was telling you", confidence: .94 }], { isFinal: true }),
        Object.assign([{ transcript: "about my long day", confidence: .92 }], { isFinal: true }),
      ], {}),
    });
    expect(second).toEqual({ text: "I was telling you about my long day", hasFinalResult: true });
  });

  it("splits long replies into natural synthesis segments", () => {
    const segments = splitSpeechSegments("Stay with me for a second. I have a longer thought that should still sound smooth and should not be cut off halfway through the browser speech queue.", 72);
    expect(segments.length).toBeGreaterThan(2);
    expect(segments.every((segment) => segment.length <= 72)).toBe(true);
    expect(segments.join(" ")).toContain("should not be cut off halfway");
  });

  it("segments a mixed Hindi and English reply without changing its voice identity", () => {
    expect(splitMultilingualSpeechSegments("Okay yaar, आज थोड़ा rest karte hain. I am here.")).toEqual([
      { text: "Okay yaar,", language: "hinglish" },
      { text: "आज थोड़ा", language: "hi" },
      { text: "rest karte hain.", language: "en" },
      { text: "I am here.", language: "en" },
    ]);
  });

  it("keeps Juno as the keyless neural voice identity for every delivery style", () => {
    expect(cloudSpeakerForVoice("mira-playful-01")).toBe("juno");
    expect(cloudSpeakerForVoice("mira-natural-01")).toBe("juno");
    expect(cloudSpeakerForVoice("mira-happy-01")).toBe("juno");
    expect(cloudSpeakerForVoice("mira-tender-01")).toBe("juno");
    expect(cloudSpeakerForVoice("mira-intimate-01")).toBe("juno");
    expect(cloudSpeakerForVoice("mira-sad-01")).toBe("juno");
    expect(cloudSpeakerForVoice("mira-angry-01")).toBe("juno");
    expect(cloudSpeakerForVoice("unknown-voice")).toBe("juno");
  });
});
