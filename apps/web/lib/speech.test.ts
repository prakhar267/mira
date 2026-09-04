import { describe, expect, it } from "vitest";
import { adaptiveRecognitionLocale, cloudSpeakerForVoice, collectRecognitionTranscript, detectSpeechLanguage, mouthPoseForText, recognitionLocale, splitMultilingualSpeechSegments, splitSpeechSegments, synthesisLanguageCode } from "./speech";

describe("companion speech", () => {
  it("detects English, Hindi, and Roman-script Hinglish", () => {
    expect(detectSpeechLanguage("That meeting was endless")).toBe("en");
    expect(detectSpeechLanguage("आज मेरा मन ठीक नहीं है")).toBe("hi");
    expect(detectSpeechLanguage("yaar aaj mood bilkul off hai")).toBe("hinglish");
  });

  it("starts automatic recognition in English and adapts after each turn", () => {
    expect(recognitionLocale("auto", "hi-IN")).toBe("en-IN");
    expect(recognitionLocale("hi")).toBe("hi-IN");
    expect(recognitionLocale("hinglish")).toBe("en-IN");
    expect(adaptiveRecognitionLocale("आज मेरा मन ठीक नहीं है")).toBe("hi-IN");
    expect(adaptiveRecognitionLocale("yaar aaj mood bilkul off hai")).toBe("en-IN");
    expect(adaptiveRecognitionLocale("Tell me about your day")).toBe("en-IN");
  });

  it("normalizes English, Hindi, and Hinglish for the multilingual neural voice", () => {
    expect(synthesisLanguageCode("Tell me about your day")).toBe("en");
    expect(synthesisLanguageCode("आज तुम कैसी हो?")).toBe("hi");
    expect(synthesisLanguageCode("yaar aaj tum bahut cute lag rahi ho")).toBe("auto");
    expect(synthesisLanguageCode("A number like 10,000", "hinglish")).toBe("auto");
  });

  it("maps nearby English and Devanagari vowels to stable mouth shapes", () => {
    expect(mouthPoseForText("open", 0)).toBe(3);
    expect(mouthPoseForText("aaj", 0)).toBe(2);
    expect(mouthPoseForText("ईमान", 0)).toBe(1);
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

  it("keeps Ara as the neural voice identity for every delivery style", () => {
    expect(cloudSpeakerForVoice("mira-playful-01")).toBe("ara");
    expect(cloudSpeakerForVoice("mira-natural-01")).toBe("ara");
    expect(cloudSpeakerForVoice("mira-happy-01")).toBe("ara");
    expect(cloudSpeakerForVoice("mira-tender-01")).toBe("ara");
    expect(cloudSpeakerForVoice("mira-intimate-01")).toBe("ara");
    expect(cloudSpeakerForVoice("mira-sad-01")).toBe("ara");
    expect(cloudSpeakerForVoice("mira-angry-01")).toBe("ara");
    expect(cloudSpeakerForVoice("unknown-voice")).toBe("ara");
  });
});
