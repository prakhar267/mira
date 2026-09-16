import { afterEach, describe, expect, it, vi } from "vitest";
import { hasUsableCallSpeech, isCallSilenceResponse, isConfidentBrowserTranscript, preferredCallTranscript, resolveCallTranscription } from "./call-listening";

describe("call speech evidence", () => {
  it("rejects clicks, fan noise, and very short bursts", () => {
    expect(hasUsableCallSpeech({ peakLevel: .05, voicedFrames: 2, voicedSpanMs: 40 })).toBe(false);
    expect(hasUsableCallSpeech({ peakLevel: .012, voicedFrames: 30, voicedSpanMs: 800 })).toBe(false);
    expect(hasUsableCallSpeech({ peakLevel: .04, voicedFrames: 12, voicedSpanMs: 90 })).toBe(false);
  });

  it("accepts sustained conversational speech", () => {
    expect(hasUsableCallSpeech({ peakLevel: .045, voicedFrames: 14, voicedSpanMs: 320 })).toBe(true);
  });

  it("prefers multilingual recognition even when English-only recognition is longer", () => {
    expect(preferredCallTranscript("  wrong browser text ", "aaj   kaafi tired hoon")).toBe("aaj kaafi tired hoon");
    expect(preferredCallTranscript("", "  meri sister Aisha hai ")).toBe("meri sister Aisha hai");
    expect(preferredCallTranscript("  browser fallback ", "")).toBe("browser fallback");
    expect(preferredCallTranscript("my manager blamed me in front of the whole team", "manager blamed me")).toBe("manager blamed me");
    expect(preferredCallTranscript("mera dost kal aa raha hai", "मेरा दोस्त कल आ रहा है")).toBe("मेरा दोस्त कल आ रहा है");
    expect(preferredCallTranscript("my sister Priya has an interview tomorrow and she is nervous", "बहन का इंटरव्यू है")).toBe("बहन का इंटरव्यू है");
  });

  it("permits browser fallback only for complete high-confidence phrases", () => {
    expect(isConfidentBrowserTranscript("yaar main usko kya bolun",.95)).toBe(true);
    expect(isConfidentBrowserTranscript("I had a bad meeting today",.92)).toBe(true);
    expect(isConfidentBrowserTranscript("I had a bad meeting today")).toBe(false);
    expect(isConfidentBrowserTranscript("I had a bad meeting today",.6)).toBe(false);
    expect(isConfidentBrowserTranscript("kya yaar")).toBe(false);
    expect(isConfidentBrowserTranscript("thanks for watching")).toBe(false);
  });

  it("treats no-speech transcription as silence instead of a call error", () => {
    expect(isCallSilenceResponse(422)).toBe(true);
    expect(isCallSilenceResponse(503)).toBe(false);
  });
});

describe("multilingual transcript delivery", () => {
  afterEach(() => vi.useRealTimers());
  const result = (status: number, text = "", error = "") => ({ response: { status, ok: status === 200 }, body: { text, error } });
  const fallback = () => vi.fn(async () => ({ text: "My English guess sounds quite confident", confidence: .99 }));

  it("delivers a ready server transcript without waiting for browser recognition", async () => {
    const browser = vi.fn(() => new Promise<{ text: string; confidence: number }>(() => undefined));
    await expect(resolveCallTranscription(Promise.resolve(result(200, "  haan bilkul ")), browser, new AbortController().signal)).resolves.toBe("haan bilkul");
    expect(browser).not.toHaveBeenCalled();
  });

  it("does not replace slower multilingual STT with a premature English guess", async () => {
    vi.useFakeTimers();
    let complete!: (value: ReturnType<typeof result>) => void;
    const server = new Promise<ReturnType<typeof result>>(resolve => { complete = resolve; });
    const browser = fallback(), delivered = vi.fn();
    const pending = resolveCallTranscription(server, browser, new AbortController().signal).then(delivered);
    await vi.advanceTimersByTimeAsync(2000);
    expect(delivered).not.toHaveBeenCalled(); expect(browser).not.toHaveBeenCalled();
    complete(result(200, "मेरा दिन अच्छा था।")); await pending;
    expect(delivered).toHaveBeenCalledExactlyOnceWith("मेरा दिन अच्छा था।");
  });

  it.each([401, 403, 429, 400, 413])("never bypasses HTTP %s with browser text", async status => {
    const browser = fallback();
    await expect(resolveCallTranscription(Promise.resolve(result(status, "", "Blocked")), browser, new AbortController().signal)).rejects.toThrow("Blocked");
    expect(browser).not.toHaveBeenCalled();
  });

  it("honors no-speech instead of turning it into a browser hallucination", async () => {
    const browser = fallback();
    await expect(resolveCallTranscription(Promise.resolve(result(422)), browser, new AbortController().signal)).resolves.toBeNull();
    expect(browser).not.toHaveBeenCalled();
  });

  it.each([null, result(503)])("uses a confident final browser fallback only after transport/provider failure", async server => {
    const browser = fallback();
    await expect(resolveCallTranscription(Promise.resolve(server), browser, new AbortController().signal)).resolves.toBe("My English guess sounds quite confident");
    expect(browser).toHaveBeenCalledTimes(1);
  });

  it("rejects uncertain fallback and suppresses any result after cancellation", async () => {
    await expect(resolveCallTranscription(Promise.resolve(null), async () => ({ text: "I may have heard this", confidence: .4 }), new AbortController().signal)).rejects.toThrow("clearly");
    const stop = new AbortController(), browser = fallback(); stop.abort();
    await expect(resolveCallTranscription(Promise.resolve(result(200, "late reply")), browser, stop.signal)).rejects.toThrow();
    expect(browser).not.toHaveBeenCalled();
  });

  it("also fences cancellation during the last-resort fallback", async () => {
    const stop = new AbortController();
    await expect(resolveCallTranscription(Promise.resolve(null), async () => { stop.abort(); return { text: "I may have heard this", confidence: .99 }; }, stop.signal)).rejects.toThrow();
  });
});
