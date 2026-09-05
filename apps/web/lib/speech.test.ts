import { describe, expect, it } from "vitest";
import { mouthPoseForText, normalizeHinglishText, romanizeHindiForEnglishTts } from "./speech";

describe("single Hinglish speech pipeline", () => {
  it("keeps Roman Hinglish unchanged", () => {
    expect(normalizeHinglishText("  yaar   aaj work bahut hectic tha  ")).toBe("yaar aaj work bahut hectic tha");
  });

  it("converts Hindi script into Roman text for the one consistent voice", () => {
    expect(normalizeHinglishText("आज तुमसे बात करके अच्छा लगा।")).toBe("aaj tumase baat karake achchhaa lagaa.");
    expect(romanizeHindiForEnglishTts("मैं ठीक हूँ।")).toBe("main theek hoon.");
  });

  it("maps nearby vowels to stable avatar mouth shapes", () => {
    expect(mouthPoseForText("open", 0)).toBe(3);
    expect(mouthPoseForText("aaj", 0)).toBe(2);
    expect(mouthPoseForText("ek", 0)).toBe(1);
  });
});
