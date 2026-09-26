// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { VoiceCallModal } from "./VoiceCallModal";
import { VideoCallModal } from "./VideoCallModal";
import type { CallPhase } from "@/lib/call-session";
import { useCallDialog } from "./useCallDialog";
vi.mock(
  "framer-motion",
  async () => (await import("../tests/ui-test-helpers")).motionMock,
);
const runtime = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  call: {
    setTalkOver: vi.fn(),
    setMuted: vi.fn(),
    setSpeaker: vi.fn(),
    interrupt: vi.fn(),
    retry: vi.fn(),
    say: vi.fn(),
    close: vi.fn(),
  },
  fetch: vi.fn(),
  avatar: vi.fn(),
}));
vi.mock("./useCompanionCall", () => ({
  useCompanionCall: () => ({
    ...runtime.state,
    call: { current: runtime.call },
  }),
}));
vi.mock("@/lib/avatar-delivery", () => ({
  avatarDelivery: { portraitPath: "/portrait.png" },
  fetchAvatarDelivery: runtime.fetch,
}));
vi.mock("./LiveAvatar3D", () => ({
  LiveAvatar3D: (props: unknown) => {
    runtime.avatar(props);
    return <div>Avatar hardware boundary</div>;
  },
}));
const button = (name: string | RegExp) =>
  fireEvent.click(screen.getByRole("button", { name }));
const props = () => ({
  companionName: "Mira",
  userName: "QA",
  onUserTurn: vi.fn().mockResolvedValue("A reply"),
  onClose: vi.fn(),
});
const stop = vi.fn(),
  stream = { getTracks: () => [{ stop }] },
  getUserMedia = vi.fn(),
  drawImage = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  runtime.state = {
    phase: "idle",
    companionLine: "Hello",
    userLine: "",
    error: "",
    muted: false,
    speaker: true,
    talkOver: false,
    seconds: 65,
    mouthPose: 0,
  };
  runtime.fetch.mockResolvedValue(new ArrayBuffer(8));
  getUserMedia.mockResolvedValue(stream);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage,
  } as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/jpeg;base64,FRAME",
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe("voice and video call controls", () => {
  it.each([
    "idle",
    "opening-mic",
    "listening",
    "transcribing",
    "thinking",
    "preparing",
    "speaking",
    "error",
    "closed",
  ] as CallPhase[])(
    "reflects the %s phase without exposing disabled actions",
    async (phase) => {
      const p = props();
      runtime.state.phase = phase;
      const v = render(<VoiceCallModal {...p} />);
      expect(screen.getByText("01:05")).toBeTruthy();
      const action = document.querySelector(".barge-in") as HTMLButtonElement;
      expect(action.disabled).toBe(
        ["thinking", "transcribing", "opening-mic"].includes(phase),
      );
      fireEvent.click(action);
      if (!action.disabled)
        expect(
          ["speaking", "preparing"].includes(phase)
            ? runtime.call.interrupt
            : runtime.call.retry,
        ).toHaveBeenCalled();
      v.unmount();
      render(
        <VideoCallModal
          {...p}
          initialEnvironment="window-nook"
          onAnalyzeFrame={vi.fn()}
        />,
      );
      await screen.findByText("Avatar hardware boundary");
      const videoAction = document.querySelector(
        ".barge-in",
      ) as HTMLButtonElement;
      expect(videoAction.disabled).toBe(
        ["thinking", "transcribing", "opening-mic"].includes(phase),
      );
      fireEvent.click(videoAction);
      expect(
        (
          screen.getByRole("button", {
            name: "Frame understanding unavailable",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
    },
  );
  it.each(["voice", "video"])(
    "toggles %s captions, microphone, speaker, talk-over, reactions and ends with duration",
    async (kind) => {
      const p = props();
      runtime.state = {
        ...runtime.state,
        phase: "speaking",
        userLine: "I am here",
        error: "Speech temporarily unavailable",
      };
      const element = () =>
        kind === "voice" ? (
          <VoiceCallModal {...p} voiceId="Ashley" />
        ) : (
          <VideoCallModal
            {...p}
            voiceId="Ashley"
            initialEnvironment="rooftop"
            onAnalyzeFrame={vi.fn()}
          />
        );
      const v = render(element());
      if (kind === "video") await screen.findByText("Avatar hardware boundary");
      expect(screen.getByText("I am here")).toBeTruthy();
      expect(screen.getByText("Speech temporarily unavailable")).toBeTruthy();
      button("Hide captions");
      expect(screen.queryByText("I am here")).toBeNull();
      button("Show captions");
      button("Mute microphone");
      expect(runtime.call.setMuted).toHaveBeenCalledWith(true);
      button("Turn speaker off");
      expect(runtime.call.setSpeaker).toHaveBeenCalledWith(false);
      button(/Talk-over/);
      expect(runtime.call.setTalkOver).toHaveBeenCalledWith(true);
      runtime.state = {
        ...runtime.state,
        muted: true,
        speaker: false,
        talkOver: true,
        phase: "idle",
      };
      v.rerender(element());
      button("Unmute microphone");
      button("Turn speaker on");
      button(/Talk-over/);
      expect(runtime.call.setMuted).toHaveBeenLastCalledWith(false);
      expect(runtime.call.setSpeaker).toHaveBeenLastCalledWith(true);
      expect(runtime.call.setTalkOver).toHaveBeenLastCalledWith(false);
      runtime.state = { ...runtime.state, phase: "speaking", muted: false };
      v.rerender(element());
      button("Speak to interrupt · headphones");
      vi.useFakeTimers();
      button(kind === "voice" ? "Send a heart reaction" : "Send heart");
      expect(document.querySelector(".call-heart")).toBeTruthy();
      act(() => vi.advanceTimersByTime(1501));
      expect(document.querySelector(".call-heart")).toBeNull();
      button(kind === "voice" ? "End call" : "End video call");
      expect(runtime.call.close).toHaveBeenCalled();
      expect(p.onClose).toHaveBeenCalledWith(65);
    },
  );
  it("keeps focus inside the call, uses the latest Escape handler and restores the invoking control", () => {
    const end = vi.fn(),
      updated = vi.fn();
    const launcher = document.createElement("button");
    document.body.appendChild(launcher);
    launcher.focus();
    function Dialog({
      onEnd,
      empty = false,
    }: {
      onEnd: () => void;
      empty?: boolean;
    }) {
      const ref = useCallDialog(onEnd);
      return (
        <div ref={ref} role="dialog">
          {empty ? null : (
            <>
              <button>First</button>
              <button>Last</button>
            </>
          )}
        </div>
      );
    }
    const v = render(<Dialog onEnd={end} />);
    expect(document.activeElement).toBe(screen.getByText("First"));
    fireEvent.keyDown(screen.getByRole("dialog"), {
      key: "Tab",
      shiftKey: true,
    });
    expect(document.activeElement).toBe(screen.getByText("Last"));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByText("First"));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowDown" });
    v.rerender(<Dialog onEnd={updated} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(updated).toHaveBeenCalledOnce();
    expect(end).not.toHaveBeenCalled();
    v.unmount();
    expect(document.activeElement).toBe(launcher);
    const v2 = render(<Dialog onEnd={end} empty />);
    launcher.remove();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab" });
    v2.unmount();
  });
  it("offers activities and owns the avatar download for the lifetime of the video call", async () => {
    const p = props();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const v = render(
      <VideoCallModal
        {...p}
        initialEnvironment="window-nook"
        onAnalyzeFrame={vi.fn()}
      />,
    );
    await screen.findByText("Avatar hardware boundary");
    const signal = runtime.fetch.mock.calls[0]![0] as AbortSignal;
    for (const name of [
      "Would you rather",
      "Relationship cards",
      "Plan a date",
      "Tell me about your day",
    ]) {
      button("Activity");
      button(name);
      expect(screen.getByText(name)).toBeTruthy();
      button("Close card");
    }
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(p.onClose).toHaveBeenCalledWith(65);
    v.unmount();
    expect(signal.aborted).toBe(true);
    vi.useFakeTimers();
    const v2 = render(
      <VideoCallModal
        {...p}
        initialEnvironment="window-nook"
        onAnalyzeFrame={vi.fn()}
      />,
    );
    await act(async () => vi.advanceTimersByTimeAsync(3400));
    expect(runtime.avatar.mock.calls.at(-1)![0]).toMatchObject({
      blinking: true,
    });
    await act(async () => vi.advanceTimersByTimeAsync(115));
    expect(runtime.avatar.mock.calls.at(-1)![0]).toMatchObject({
      blinking: false,
    });
    v2.unmount();
  });
});
describe("video camera capture consent", () => {
  const videoProps = () => ({
    ...props(),
    initialEnvironment: "window-nook",
    frameUnderstanding: true,
    onAnalyzeFrame: vi.fn().mockResolvedValue("A desk drawing"),
  });
  it("keeps the camera local until a frame gesture, resizes it, then stops on toggle/background", async () => {
    const p = videoProps();
    render(<VideoCallModal {...p} />);
    await screen.findByText("Avatar hardware boundary");
    expect(getUserMedia).not.toHaveBeenCalled();
    button("Turn it on");
    await screen.findByRole("button", { name: "Turn camera off" });
    const video = screen.getByLabelText(
      "Your local camera preview",
    ) as HTMLVideoElement;
    expect(video.srcObject).toBe(stream);
    Object.defineProperty(video, "videoWidth", {
      configurable: true,
      value: 1920,
    });
    Object.defineProperty(video, "videoHeight", {
      configurable: true,
      value: 1080,
    });
    expect(p.onAnalyzeFrame).not.toHaveBeenCalled();
    button("Show frame");
    await waitFor(() =>
      expect(runtime.call.say).toHaveBeenCalledWith("A desk drawing"),
    );
    expect(p.onAnalyzeFrame).toHaveBeenCalledWith("FRAME", "image/jpeg");
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 960, 540);
    button("Turn camera off");
    expect(stop).toHaveBeenCalled();
    expect(video.srcObject).toBeNull();
    button("Turn camera on");
    await screen.findByRole("button", { name: "Turn camera off" });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(screen.getByRole("button", { name: "Turn camera on" })).toBeTruthy();
  });
  it.each(["warming", "context", "empty", "provider", "unknown"])(
    "recovers from a %s frame error",
    async (error) => {
      const p = videoProps();
      render(<VideoCallModal {...p} />);
      button("Turn camera on");
      await screen.findByRole("button", { name: "Turn camera off" });
      const video = screen.getByLabelText("Your local camera preview");
      if (error !== "warming") {
        Object.defineProperty(video, "videoWidth", { value: 100 });
        Object.defineProperty(video, "videoHeight", { value: 100 });
      }
      if (error === "context")
        vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
      if (error === "empty")
        vi.mocked(HTMLCanvasElement.prototype.toDataURL).mockReturnValue(
          "invalid",
        );
      if (error === "provider")
        p.onAnalyzeFrame.mockRejectedValueOnce(Error("Vision unavailable"));
      if (error === "unknown")
        p.onAnalyzeFrame.mockRejectedValueOnce("offline");
      button("Show frame");
      await screen.findByText(
        error === "warming"
          ? "The camera is still warming up."
          : ["context", "empty"].includes(error)
            ? "The current frame could not be prepared."
            : error === "provider"
              ? "Vision unavailable"
              : "The current frame could not be shared.",
      );
      expect(runtime.call.say).not.toHaveBeenCalled();
    },
  );
  it.each(["missing", "permission", "play"])(
    "keeps the camera off after %s failure",
    async (error) => {
      const p = videoProps();
      if (error === "missing")
        Object.defineProperty(navigator, "mediaDevices", {
          configurable: true,
          value: undefined,
        });
      if (error === "permission")
        getUserMedia.mockRejectedValueOnce(Error("denied"));
      if (error === "play")
        vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(
          Error("blocked"),
        );
      render(<VideoCallModal {...p} />);
      button("Turn camera on");
      await screen.findByText(/Camera stayed off/);
      if (error === "play") expect(stop).toHaveBeenCalled();
    },
  );
  it("stops late permission and playback results and never speaks a frame result after hanging up", async () => {
    let resolve!: (v: unknown) => void;
    getUserMedia.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const p = videoProps();
    const v = render(<VideoCallModal {...p} />);
    button("Turn camera on");
    v.unmount();
    await act(async () => resolve(stream));
    expect(stop).toHaveBeenCalled();
    let finishPlay!: () => void;
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(
      () =>
        new Promise((r) => {
          finishPlay = r;
        }),
    );
    const v2 = render(<VideoCallModal {...p} />);
    button("Turn camera on");
    await waitFor(() => expect(finishPlay).toBeDefined());
    v2.unmount();
    await act(async () => finishPlay());
    expect(stop).toHaveBeenCalledTimes(3);
    let finishFrame!: (v: string) => void;
    p.onAnalyzeFrame.mockImplementationOnce(
      () =>
        new Promise((r) => {
          finishFrame = r;
        }),
    );
    render(<VideoCallModal {...p} />);
    button("Turn camera on");
    await screen.findByRole("button", { name: "Turn camera off" });
    const video = screen.getByLabelText("Your local camera preview");
    Object.defineProperty(video, "videoWidth", { value: 100 });
    Object.defineProperty(video, "videoHeight", { value: 100 });
    button("Show frame");
    button("End video call");
    await act(async () => finishFrame("Late description"));
    expect(runtime.call.say).not.toHaveBeenCalled();
  });
});
