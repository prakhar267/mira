import { describe, expect, it } from "vitest";
import { cloudSpeakerForVoice, collectRecognitionTranscript, detectSpeechLanguage, recognitionLocale, selectPreferredVoice, splitSpeechSegments } from "./speech";

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

  it("prefers a natural feminine Hindi voice over an English default", () => {
    const voices = [
      { name: "Alex", lang: "en-US", default: true },
      { name: "Lekha Enhanced", lang: "hi-IN", default: false },
    ];
    expect(selectPreferredVoice(voices, "आज कैसा दिन था", "mira-warm-01")?.name).toBe("Lekha Enhanced");
  });

  it("keeps one natural woman voice across styles and supported languages", () => {
    const voices = [
      { name: "Samantha", lang: "en-US", default: true },
      { name: "Tessa", lang: "en-ZA", default: false },
      { name: "Karen", lang: "en-AU", default: false },
      { name: "Flo (English (US))", lang: "en-US", default: false },
      { name: "Tara", lang: "en-IN", default: false },
      { name: "Aman", lang: "en-IN", default: false },
      { name: "Lekha", lang: "hi-IN", default: false },
    ];

    expect(selectPreferredVoice(voices, "Tell me something fun", "mira-playful-01", "en")?.name).toBe("Samantha");
    expect(selectPreferredVoice(voices, "Stay close to me", "mira-seductive-01", "en")?.name).toBe("Samantha");
    expect(selectPreferredVoice(voices, "Be direct with me", "mira-sharp-01", "en")?.name).toBe("Samantha");
    expect(selectPreferredVoice(voices, "I need some confidence", "mira-confident-01", "en")?.name).toBe("Samantha");
    expect(selectPreferredVoice(voices, "yaar aaj mood off hai", "mira-warm-01", "hinglish")?.name).toBe("Samantha");
    expect(selectPreferredVoice(voices, "आज कैसा दिन था", "mira-warm-01", "hi")?.name).toBe("Samantha");
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

  it("keeps Luna as the neural voice identity for every delivery style", () => {
    expect(cloudSpeakerForVoice("mira-playful-01")).toBe("luna");
    expect(cloudSpeakerForVoice("mira-warm-01")).toBe("luna");
    expect(cloudSpeakerForVoice("mira-soft-01")).toBe("luna");
    expect(cloudSpeakerForVoice("mira-seductive-01")).toBe("luna");
    expect(cloudSpeakerForVoice("mira-calm-01")).toBe("luna");
    expect(cloudSpeakerForVoice("mira-confident-01")).toBe("luna");
    expect(cloudSpeakerForVoice("mira-sharp-01")).toBe("luna");
    expect(cloudSpeakerForVoice("unknown-voice")).toBe("luna");
  });
});
