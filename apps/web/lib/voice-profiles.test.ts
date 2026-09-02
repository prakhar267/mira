import { describe, expect, it } from "vitest";
import { companionVoiceProfile, companionVoiceProfiles } from "./voice-profiles";

describe("companion voice profiles", () => {
  it("keeps one voice identity while offering distinct delivery styles", () => {
    expect(companionVoiceProfiles.map((profile) => profile.name)).toEqual([
      "Warm",
      "Playful",
      "Soft",
      "Seductive",
      "Mellow",
      "Confident",
      "Sharp",
    ]);
    expect(new Set(companionVoiceProfiles.map((profile) => profile.id)).size).toBe(companionVoiceProfiles.length);
    expect(new Set(companionVoiceProfiles.map((profile) => profile.speaker))).toEqual(new Set(["luna"]));
    expect(new Set(companionVoiceProfiles.map((profile) => `${profile.rate}:${profile.pitch}`)).size).toBe(companionVoiceProfiles.length);
  });

  it("uses the playful profile when an older or unknown voice id is loaded", () => {
    expect(companionVoiceProfile("unknown").id).toBe("mira-playful-01");
  });
});
