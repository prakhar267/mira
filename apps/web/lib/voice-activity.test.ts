import { describe, expect, it } from "vitest";
import { microphoneRms } from "./voice-activity";

describe("microphone activity", () => {
  it("measures silence and speech energy without depending on sample polarity", () => {
    expect(microphoneRms(new Float32Array([0, 0, 0]))).toBe(0);
    expect(microphoneRms(new Float32Array([.2, -.2, .2, -.2]))).toBeCloseTo(.2, 5);
  });
});
