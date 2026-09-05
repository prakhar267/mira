import { describe, expect, it } from "vitest";
import { hasUsableCallSpeech, isCallSilenceResponse, preferredCallTranscript } from "./call-listening";

describe("call speech evidence", () => {
  it("rejects clicks, fan noise, and very short bursts", () => {
    expect(hasUsableCallSpeech({ peakLevel: .05, voicedFrames: 2, voicedSpanMs: 40 })).toBe(false);
    expect(hasUsableCallSpeech({ peakLevel: .012, voicedFrames: 30, voicedSpanMs: 800 })).toBe(false);
    expect(hasUsableCallSpeech({ peakLevel: .04, voicedFrames: 12, voicedSpanMs: 90 })).toBe(false);
  });

  it("accepts sustained conversational speech", () => {
    expect(hasUsableCallSpeech({ peakLevel: .045, voicedFrames: 14, voicedSpanMs: 320 })).toBe(true);
  });

  it("prefers free browser recognition and falls back to the server transcript", () => {
    expect(preferredCallTranscript("  aaj   kaafi tired hoon ", "wrong server text")).toBe("aaj kaafi tired hoon");
    expect(preferredCallTranscript("", "  meri sister Aisha hai ")).toBe("meri sister Aisha hai");
  });

  it("treats no-speech transcription as silence instead of a call error", () => {
    expect(isCallSilenceResponse(422)).toBe(true);
    expect(isCallSilenceResponse(503)).toBe(false);
  });
});
