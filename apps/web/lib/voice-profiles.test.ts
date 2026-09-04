import { describe, expect, it } from "vitest";
import { companionVoiceIdentity, companionVoiceMode, companionVoiceModes } from "./voice-profiles";

describe("companion voice modes", () => {
  it("keeps one named voice identity while offering emotional delivery modes", () => {
    expect(companionVoiceIdentity.name).toBe("Mira Aster");
    expect(companionVoiceModes.map((mode) => mode.name)).toEqual([
      "Natural",
      "Happy",
      "Playful",
      "Tender",
      "Intimate",
      "Sad",
      "Angry",
    ]);
    expect(new Set(companionVoiceModes.map((mode) => mode.id)).size).toBe(companionVoiceModes.length);
    expect(new Set(companionVoiceModes.map((mode) => mode.speaker))).toEqual(new Set(["ara"]));
    expect(new Set(companionVoiceModes.map((mode) => mode.emotion)).size).toBe(companionVoiceModes.length);
    expect(new Set(companionVoiceModes.map((mode) => mode.volume)).size).toBeGreaterThan(3);
    expect(new Set(companionVoiceModes.map((mode) => mode.temperature)).size).toBe(companionVoiceModes.length);
    expect(companionVoiceModes.every((mode) => mode.pitch >= .98 && mode.pitch <= 1.04)).toBe(true);
    expect(companionVoiceModes.every((mode) => mode.rate <= 1)).toBe(true);
  });

  it("maps old settings and unknown ids onto the single current identity", () => {
    expect(companionVoiceMode("mira-seductive-01").id).toBe("mira-intimate-01");
    expect(companionVoiceMode("unknown").id).toBe("mira-natural-01");
  });
});
