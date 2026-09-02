import { describe, expect, it } from "vitest";
import { cloudSpeakerForVoice, detectSpeechLanguage, recognitionLocale, selectPreferredVoice } from "./speech";

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

    expect(selectPreferredVoice(voices, "Tell me something fun", "mira-playful-01", "en")?.name).toBe("Tara");
    expect(selectPreferredVoice(voices, "Stay close to me", "mira-seductive-01", "en")?.name).toBe("Tara");
    expect(selectPreferredVoice(voices, "Be direct with me", "mira-sharp-01", "en")?.name).toBe("Tara");
    expect(selectPreferredVoice(voices, "I need some confidence", "mira-confident-01", "en")?.name).toBe("Tara");
    expect(selectPreferredVoice(voices, "yaar aaj mood off hai", "mira-warm-01", "hinglish")?.name).toBe("Tara");
    expect(selectPreferredVoice(voices, "आज कैसा दिन था", "mira-warm-01", "hi")?.name).toBe("Tara");
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
