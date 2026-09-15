import { afterEach, describe, expect, it, vi } from "vitest";
import { boundedCallDiagnostic, completedRequestTiming } from "./call-qa-timing";
afterEach(() => vi.useRealTimers());
describe("bounded native call diagnostic timing", () => {
  it("uses completed native request timing without an SDK finished promise", async () => {
    expect(await boundedCallDiagnostic(signal => completedRequestTiming(() => ({ responseStart: 240, responseEnd: 1500 }), signal))).toEqual({ responseStart: 240, responseEnd: 1500 });
  });
  it("waits for real completion instead of treating response headers as EOF", async () => {
    vi.useFakeTimers(); let end = -1;
    const work = boundedCallDiagnostic(signal => completedRequestTiming(() => ({ responseStart: 240, responseEnd: end }), signal));
    await vi.advanceTimersByTimeAsync(50); end = 900;
    await vi.advanceTimersByTimeAsync(25);
    expect(await work).toEqual({ responseStart: 240, responseEnd: 900 });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("bounds stalled timing and removes polling timers", async () => {
    vi.useFakeTimers();
    const work = boundedCallDiagnostic(signal => completedRequestTiming(() => ({ responseStart: 240, responseEnd: -1 }), signal));
    const rejected = expect(work).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(15_000); await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("also bounds a stalled JSON body, not only the timing lookup", async () => {
    vi.useFakeTimers();
    const rejected = expect(boundedCallDiagnostic(() => new Promise(() => undefined))).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(15_000); await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
});
