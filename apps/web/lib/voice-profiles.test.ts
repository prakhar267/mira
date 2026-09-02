import { describe, expect, it } from "vitest";
import { companionVoiceProfile, companionVoiceProfiles } from "./voice-profiles";

describe("companion voice profiles", () => {
  it("offers distinct speakers for every visible voice style", () => {
    expect(companionVoiceProfiles.map((profile) => profile.name)).toEqual([
      "Warm",
      "Playful",
      "Soft",
      "Seductive",
      "Calm",
      "Confident",
      "Sharp",
    ]);
    expect(new Set(companionVoiceProfiles.map((profile) => profile.id)).size).toBe(companionVoiceProfiles.length);
    expect(new Set(companionVoiceProfiles.map((profile) => profile.speaker)).size).toBe(companionVoiceProfiles.length);
  });

  it("uses the playful profile when an older or unknown voice id is loaded", () => {
    expect(companionVoiceProfile("unknown").id).toBe("mira-playful-01");
  });
});
