import { describe, expect, it } from "vitest";
import { hasUsableCallSpeech, isCallSilenceResponse, isConfidentBrowserTranscript, preferredCallTranscript } from "./call-listening";

describe("call speech evidence", () => {
  it("rejects clicks, fan noise, and very short bursts", () => {
    expect(hasUsableCallSpeech({ peakLevel: .05, voicedFrames: 2, voicedSpanMs: 40 })).toBe(false);
    expect(hasUsableCallSpeech({ peakLevel: .012, voicedFrames: 30, voicedSpanMs: 800 })).toBe(false);
    expect(hasUsableCallSpeech({ peakLevel: .04, voicedFrames: 12, voicedSpanMs: 90 })).toBe(false);
  });

  it("accepts sustained conversational speech", () => {
    expect(hasUsableCallSpeech({ peakLevel: .045, voicedFrames: 14, voicedSpanMs: 320 })).toBe(true);
  });

  it("prefers multilingual server recognition but keeps a clearly fuller browser transcript", () => {
    expect(preferredCallTranscript("  wrong browser text ", "aaj   kaafi tired hoon")).toBe("aaj kaafi tired hoon");
    expect(preferredCallTranscript("", "  meri sister Aisha hai ")).toBe("meri sister Aisha hai");
    expect(preferredCallTranscript("  browser fallback ", "")).toBe("browser fallback");
    expect(preferredCallTranscript("my manager blamed me in front of the whole team", "manager blamed me")).toBe("my manager blamed me in front of the whole team");
    expect(preferredCallTranscript("mera dost kal aa raha hai", "मेरा दोस्त कल आ रहा है")).toBe("मेरा दोस्त कल आ रहा है");
    expect(preferredCallTranscript("my sister Priya has an interview tomorrow and she is nervous", "बहन का इंटरव्यू है")).toBe("my sister Priya has an interview tomorrow and she is nervous");
  });

  it("uses browser recognition early only for complete phrases", () => {
    expect(isConfidentBrowserTranscript("yaar main usko kya bolun")).toBe(true);
    expect(isConfidentBrowserTranscript("I had a bad meeting today")).toBe(true);
    expect(isConfidentBrowserTranscript("kya yaar")).toBe(false);
    expect(isConfidentBrowserTranscript("thanks for watching")).toBe(false);
  });

  it("treats no-speech transcription as silence instead of a call error", () => {
    expect(isCallSilenceResponse(422)).toBe(true);
    expect(isCallSilenceResponse(503)).toBe(false);
  });
});
