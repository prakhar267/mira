// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useCompanionCall } from "./useCompanionCall";
import { playCompanionSpeech } from "@/lib/speech";
import { startCallListening } from "@/lib/call-listening";
import { trackEvent } from "@/lib/analytics";
vi.mock("@/lib/speech", () => ({
  playCompanionSpeech: vi.fn(),
  mouthPoseForText: vi.fn(() => 2),
}));
vi.mock("@/lib/call-listening", () => ({ startCallListening: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
const cancelSpeech = vi.fn(),
  cancelListen = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.mocked(playCompanionSpeech).mockReturnValue({
    cancel: cancelSpeech,
  } as never);
  vi.mocked(startCallListening).mockResolvedValue({
    cancel: cancelListen,
  } as never);
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it("starts after mount, synchronizes mouth poses to audible boundaries, counts time and mutes in the background", async () => {
  const respond = vi.fn().mockResolvedValue("A reply");
  const hook = renderHook(() => useCompanionCall("QA", respond, "Ashley"));
  expect(playCompanionSpeech).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(150));
  expect(playCompanionSpeech).toHaveBeenCalledWith(
    "Hey QA, you made it. What’s going on?",
    expect.objectContaining({ voiceId: "Ashley" }),
  );
  const speech = vi.mocked(playCompanionSpeech).mock.calls[0]![1]!;
  act(() => speech.onBoundary?.({ charIndex: 1 } as never));
  expect(hook.result.current.mouthPose).toBe(0);
  act(() => speech.onAudioLevel?.(0.5));
  expect(hook.result.current.mouthPose).toBe(2);
  act(() => speech.onBoundary?.({ charIndex: 2 } as never));
  expect(hook.result.current.mouthPose).toBe(2);
  act(() => speech.onAudioLevel?.(0));
  expect(hook.result.current.mouthPose).toBe(0);
  act(() => speech.onStart?.());
  expect(trackEvent).toHaveBeenCalledWith("call_speech_ms", expect.any(Number));
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(hook.result.current.seconds).toBe(1);
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: true,
  });
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(hook.result.current.muted).toBe(true);
  expect(hook.result.current.speaker).toBe(false);
  hook.unmount();
  expect(cancelSpeech).toHaveBeenCalled();
});
it("uses the latest response callback and closes timers before an early unmount", async () => {
  const first = vi.fn().mockResolvedValue("First"),
    next = vi.fn().mockResolvedValue("Latest");
  const hook = renderHook(({ respond }) => useCompanionCall("QA", respond), {
    initialProps: { respond: first },
  });
  await act(async () => vi.advanceTimersByTimeAsync(150));
  act(() => vi.mocked(playCompanionSpeech).mock.calls[0]![1]!.onEnd?.());
  await act(async () => vi.advanceTimersByTimeAsync(181));
  hook.rerender({ respond: next });
  const listener = vi.mocked(startCallListening).mock.calls[0]![0];
  await act(async () => listener.onTranscript("A spoken question"));
  expect(next).toHaveBeenCalledWith(
    "A spoken question",
    expect.objectContaining({ turnId: expect.any(String) }),
  );
  expect(first).not.toHaveBeenCalled();
  hook.unmount();
  const before = vi.mocked(playCompanionSpeech).mock.calls.length;
  const early = renderHook(() => useCompanionCall("QA", first));
  early.unmount();
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(playCompanionSpeech).toHaveBeenCalledTimes(before);
});
