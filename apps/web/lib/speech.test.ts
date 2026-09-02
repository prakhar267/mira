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

  it("maps companion styles to feminine Aura speakers", () => {
    expect(cloudSpeakerForVoice("mira-playful-01")).toBe("luna");
    expect(cloudSpeakerForVoice("mira-warm-01")).toBe("helena");
    expect(cloudSpeakerForVoice("mira-soft-01")).toBe("aurora");
    expect(cloudSpeakerForVoice("mira-seductive-01")).toBe("vesta");
    expect(cloudSpeakerForVoice("mira-calm-01")).toBe("cora");
    expect(cloudSpeakerForVoice("mira-confident-01")).toBe("thalia");
    expect(cloudSpeakerForVoice("mira-sharp-01")).toBe("theia");
    expect(cloudSpeakerForVoice("unknown-voice")).toBe("luna");
  });
});
