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
import { ChatView } from "./ChatView";
import { dialogSupport, viewState } from "../tests/ui-test-helpers";
vi.mock("@/lib/speech", () => ({ playCompanionSpeech: vi.fn() }));
vi.mock("@/lib/video-preload", () => ({ preloadVideoCall: vi.fn() }));
const click = (name: string | RegExp) =>
  fireEvent.click(screen.getByRole("button", { name }));
const change = (name: string, value: string) =>
  fireEvent.change(screen.getByRole("textbox", { name }), {
    target: { value },
  });
function without<T, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const copy = { ...value };
  delete copy[key];
  return copy;
}
function props() {
  const state = viewState();
  state.messages = [
    {
      id: "u",
      conversationId: state.activeConversationId,
      role: "user",
      content: "A user message",
      createdAt: "2026-09-26T09:00:00Z",
      status: "sent",
    },
    {
      id: "a",
      conversationId: state.activeConversationId,
      role: "assistant",
      content: "A helpful response",
      createdAt: "2026-09-26T09:00:01Z",
      status: "sent",
    },
  ];
  return {
    state,
    processingEnabled: true,
    streaming: false,
    onSend: vi.fn().mockResolvedValue(undefined),
    onNewConversation: vi.fn(),
    onDeleteConversation: vi.fn().mockResolvedValue(undefined),
    onBack: vi.fn(),
    onCall: vi.fn(),
    onVideoCall: vi.fn(),
    onVoiceNote: vi.fn().mockResolvedValue(undefined),
    onVoiceRecording: vi.fn().mockResolvedValue(undefined),
    onSpeak: vi.fn().mockResolvedValue(undefined),
    onImageUpload: vi.fn().mockResolvedValue(undefined),
    onGenerateImage: vi.fn().mockResolvedValue(undefined),
    onFeedback: vi.fn(),
    onRegenerate: vi.fn(),
    onUpgrade: vi.fn(),
    onCamera: vi.fn(),
  };
}
beforeEach(() => {
  dialogSupport();
  HTMLElement.prototype.scrollTo = vi.fn();
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("chat controls and transcript privacy", () => {
  it("sends trimmed content, restores failed drafts, keeps Shift+Enter and prevents duplicate streaming sends", async () => {
    const p = props();
    const v = render(<ChatView {...p} />);
    change("Message Mira", "  A question  ");
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Message Mira" }), {
      key: "Enter",
      shiftKey: true,
    });
    expect(p.onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Message Mira" }), {
      key: "Enter",
    });
    await waitFor(() => expect(p.onSend).toHaveBeenCalledWith("A question"));
    for (const failure of [new Error("Network unavailable"), "offline"]) {
      p.onSend.mockRejectedValueOnce(failure);
      change("Message Mira", "Please retry");
      click("Send message");
      await waitFor(() =>
        expect(
          (
            screen.getByRole("textbox", {
              name: "Message Mira",
            }) as HTMLTextAreaElement
          ).value,
        ).toBe("Please retry"),
      );
    }
    v.rerender(
      <ChatView {...p} streaming streamingText="Temporary unsaved words" />,
    );
    expect(screen.getByText("Temporary unsaved words")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Message Mira" }), {
      key: "Enter",
    });
    expect(p.onSend).toHaveBeenCalledTimes(3);
    v.rerender(<ChatView {...p} streaming />);
    expect(screen.getByLabelText("Mira is typing")).toBeTruthy();
    v.rerender(<ChatView {...p} processingEnabled={false} />);
    expect(
      (
        screen.getByRole("textbox", {
          name: "Message Mira",
        }) as HTMLTextAreaElement
      ).disabled,
    ).toBe(true);
    expect(screen.getByText(/AI processing is paused in Privacy/)).toBeTruthy();
  });
  it("routes navigation, search, suggestions, reason-specific feedback and response actions", async () => {
    const p = props();
    const v = render(<ChatView {...p} />);
    for (const name of [
      "Back to home",
      "New chat",
      "Start voice call with Mira",
      "Start video call with Mira",
    ])
      click(name);
    for (const cb of [p.onBack, p.onNewConversation, p.onCall, p.onVideoCall])
      expect(cb).toHaveBeenCalled();
    click("Just listen to me");
    expect(
      (
        screen.getByRole("textbox", {
          name: "Message Mira",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("Just listen to me");
    click("Good response");
    expect(p.onFeedback).toHaveBeenCalledWith("a", "up");
    for (const [label, reason] of [
      ["Too scripted", "too-scripted"],
      ["Too many questions", "too-many-questions"],
      ["Missed what I said", "missed-what-i-said"],
      ["Wrong tone", "wrong-tone"],
    ]) {
      click("Poor response");
      click(label!);
      expect(p.onFeedback).toHaveBeenLastCalledWith("a", "down", reason);
    }
    click("Hear response");
    expect(p.onSpeak).toHaveBeenCalledWith("A helpful response");
    click("Regenerate response");
    expect(p.onRegenerate).toHaveBeenCalledWith("a");
    click("Why?");
    expect(screen.getByText(/No per-response explanation/)).toBeTruthy();
    click("Close dialog");
    click("Edit");
    expect(
      (
        screen.getByRole("textbox", {
          name: "Message Mira",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("A user message");
    fireEvent.click(screen.getAllByRole("button", { name: "Reply" })[1]!);
    expect(
      (
        screen.getByRole("textbox", {
          name: "Message Mira",
        }) as HTMLTextAreaElement
      ).value,
    ).toContain("A helpful response");
    click("Search conversations");
    expect(screen.getByRole("dialog")).toBeTruthy();
    click("Close dialog");
    click("Conversation tools");
    click("New conversation");
    expect(p.onNewConversation).toHaveBeenCalledTimes(2);
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });
    act(() => window.dispatchEvent(new Event("offline")));
    expect(screen.getByText(/Offline · keep/)).toBeTruthy();
    const { playCompanionSpeech } = await import("@/lib/speech");
    p.state.messages[1] = {
      ...p.state.messages[1]!,
      content: "x".repeat(80),
      explanation: ["Used an approved memory"],
      feedback: "up",
      attachments: [
        { id: "audio", type: "audio", url: "/audio.webm", durationMs: 1200 },
        { id: "audio2", type: "audio", url: "/audio.webm" },
        { id: "image", type: "image", url: "/sample.png" },
        {
          id: "image2",
          type: "image",
          url: "/sample.png",
          name: "Named image",
        },
      ],
    };
    p.state.messages = [...p.state.messages];
    v.rerender(<ChatView {...without(p, "onSpeak")} />);
    click("Hear response");
    expect(playCompanionSpeech).toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: "Reply" })[1]!);
    expect(
      (
        screen.getByRole("textbox", {
          name: "Message Mira",
        }) as HTMLTextAreaElement
      ).value,
    ).toContain("…");
    click("Why?");
    expect(screen.getByText("Used an approved memory")).toBeTruthy();
    click("Close dialog");
    expect(screen.getByAltText("Shared image")).toBeTruthy();
  });
  it("maintains older-message scroll position and reports both typed and untyped load failures", async () => {
    const p = props(),
      load = vi.fn().mockResolvedValue(undefined);
    const v = render(<ChatView {...p} onLoadOlder={load} />);
    const viewport = document.querySelector(".chat__messages")!;
    fireEvent.scroll(viewport);
    click("Load earlier messages");
    await waitFor(() => expect(load).toHaveBeenCalled());
    p.state.messages = [...p.state.messages];
    v.rerender(<ChatView {...p} onLoadOlder={load} />);
    await new Promise((resolve) => setTimeout(resolve, 30));
    for (const cause of [Error("Page failed"), "offline"]) {
      load.mockRejectedValueOnce(cause);
      click("Load earlier messages");
      await waitFor(() =>
        expect(screen.getByRole("status").textContent).toMatch(
          /Page failed|Older messages could not load/,
        ),
      );
    }
    v.rerender(<ChatView {...p} onLoadOlder={load} loadingOlder />);
    expect(
      (
        screen.getByRole("button", {
          name: "Loading earlier messages…",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
  it("uploads only selected files, labels generated images and preserves failed deletion until retried", async () => {
    const p = props();
    const v = render(<ChatView {...p} mediaEnabled liveMode />);
    const input = screen.getByLabelText("Upload a photo", {
      selector: "input",
    });
    fireEvent.change(input, { target: { files: [] } });
    expect(p.onImageUpload).not.toHaveBeenCalled();
    for (const cause of [Error("Upload failed"), "offline"]) {
      p.onImageUpload.mockRejectedValueOnce(cause);
      fireEvent.change(input, {
        target: {
          files: [new File(["image"], "qa.png", { type: "image/png" })],
        },
      });
      await waitFor(() =>
        expect(screen.getByRole("status").textContent).toMatch(
          /Upload failed|image could not be shared/,
        ),
      );
    }
    click("Attach image");
    click("Upload a photo");
    click("Conversation tools");
    click("Share a photo");
    click("Camera understanding");
    expect(p.onCamera).toHaveBeenCalled();
    click("Conversation tools");
    click("Create an image");
    change("Describe the scene", "   ");
    fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
    expect(p.onGenerateImage).not.toHaveBeenCalled();
    for (const cause of [Error("Image unavailable"), "offline"]) {
      p.onGenerateImage.mockRejectedValueOnce(cause);
      change("Describe the scene", "  A moonlit window  ");
      click("Create image");
      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toMatch(
          /Image unavailable|image could not be created/,
        ),
      );
    }
    click("Create image");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(p.onGenerateImage).toHaveBeenLastCalledWith("A moonlit window");
    click("Conversation tools");
    click("Create an image");
    click("Cancel");
    click("Conversation tools");
    click("Create an image");
    click("Close dialog");
    click("Conversation tools");
    click("Delete this conversation");
    click("Cancel");
    click("Conversation tools");
    click("Delete this conversation");
    click("Close dialog");
    click("Conversation tools");
    click("Delete this conversation");
    for (const cause of [Error("Delete failed"), "offline"]) {
      p.onDeleteConversation.mockRejectedValueOnce(cause);
      click("Delete conversation");
      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toMatch(
          /Delete failed|conversation could not be deleted/,
        ),
      );
    }
    click("Delete conversation");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    v.rerender(<ChatView {...p} mediaEnabled />);
    click("Conversation tools");
    click("Create an image");
    expect(screen.getByText(/small set of approved/)).toBeTruthy();
  });
});

class Recorder {
  static latest: Recorder;
  static supported = true;
  static isTypeSupported() {
    return Recorder.supported;
  }
  state = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    Recorder.latest = this;
  }
  start = vi.fn(() => {
    this.state = "recording";
  });
  stop = vi.fn(() => {
    this.state = "inactive";
    this.onstop?.();
  });
  data(size = 5) {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(size)]) });
  }
}
class Recognition {
  static latest: Recognition;
  continuous = false;
  interimResults = false;
  lang = "";
  onresult:
    | ((e: { results: Array<{ 0?: { transcript?: string } }> }) => void)
    | null = null;
  onerror: (() => void) | null = null;
  onend: (() => void) | null = null;
  constructor() {
    Recognition.latest = this;
  }
  start = vi.fn();
  stop = vi.fn(() => this.onend?.());
  abort = vi.fn();
}
function recordingSetup() {
  const stop = vi.fn(),
    stream = { getTracks: () => [{ stop }] };
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  vi.stubGlobal("MediaRecorder", Recorder);
  return { stop, stream, getUserMedia };
}
describe("explicit voice recording and cancellation", () => {
  it("records a bounded note and sends only after stopping", async () => {
    const p = props(),
      media = recordingSetup();
    Recorder.supported = true;
    render(<ChatView {...p} />);
    click("Record voice note");
    await screen.findByRole("button", { name: "Stop recording voice note" });
    expect(p.onVoiceRecording).not.toHaveBeenCalled();
    act(() => Recorder.latest.data());
    click("Stop recording voice note");
    await waitFor(() =>
      expect(p.onVoiceRecording).toHaveBeenCalledWith(
        expect.any(String),
        "audio/webm",
      ),
    );
    expect(media.stop).toHaveBeenCalled();
  });
  it.each([Error("Transcript failed"), "offline"])(
    "shows a failed recording upload without a transcript: %s",
    async (cause) => {
      const p = props();
      recordingSetup();
      Recorder.supported = false;
      p.onVoiceRecording.mockRejectedValueOnce(cause);
      render(<ChatView {...p} />);
      click("Record voice note");
      await screen.findByRole("button", { name: "Stop recording voice note" });
      act(() => Recorder.latest.data());
      click("Stop recording voice note");
      await screen.findByText(
        cause instanceof Error
          ? cause.message
          : "The voice note could not be sent.",
      );
    },
  );
  it("rejects oversized audio and ignores an empty recording", async () => {
    const p = props();
    recordingSetup();
    render(<ChatView {...p} />);
    click("Record voice note");
    await screen.findByRole("button", { name: "Stop recording voice note" });
    act(() => Recorder.latest.data(2_500_001));
    expect(screen.getByText(/too large/)).toBeTruthy();
    expect(p.onVoiceRecording).not.toHaveBeenCalled();
    click("Record voice note");
    await screen.findByRole("button", { name: "Stop recording voice note" });
    act(() => Recorder.latest.data(0));
    click("Stop recording voice note");
    expect(p.onVoiceRecording).not.toHaveBeenCalled();
  });
  it("stops hardware errors and denied permission cleanly", async () => {
    const p = props(),
      media = recordingSetup();
    render(<ChatView {...p} />);
    media.getUserMedia.mockRejectedValueOnce(Error("denied"));
    click("Record voice note");
    await screen.findByText(/couldn’t access the microphone/);
    click("Record voice note");
    await screen.findByRole("button", { name: "Stop recording voice note" });
    act(() => Recorder.latest.onerror?.());
    expect(
      screen.getByText("The voice note could not be recorded."),
    ).toBeTruthy();
    expect(media.stop).toHaveBeenCalled();
  });
  it("stops a stream that arrives after unmount and never sends after revocation or backgrounding", async () => {
    const p = props(),
      media = recordingSetup();
    let resolve!: (v: unknown) => void;
    media.getUserMedia.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const v = render(<ChatView {...p} />);
    click("Record voice note");
    click("Record voice note");
    expect(media.getUserMedia).toHaveBeenCalledTimes(1);
    v.unmount();
    await act(async () => resolve(media.stream));
    expect(media.stop).toHaveBeenCalled();
    const v2 = render(<ChatView {...p} />);
    click("Record voice note");
    await screen.findByRole("button", { name: "Stop recording voice note" });
    const recorder = Recorder.latest;
    act(() => recorder.data());
    v2.rerender(<ChatView {...p} processingEnabled={false} />);
    act(() => {
      recorder.data();
      recorder.onerror?.();
    });
    expect(p.onVoiceRecording).not.toHaveBeenCalled();
    v2.rerender(<ChatView {...p} />);
    click("Record voice note");
    await screen.findByRole("button", { name: "Stop recording voice note" });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(
      screen.getByRole("button", { name: "Record voice note" }),
    ).toBeTruthy();
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
  });
  it("limits recordings to sixty seconds and ignores starts while streaming", async () => {
    vi.useFakeTimers();
    const p = props();
    recordingSetup();
    const v = render(<ChatView {...p} streaming />);
    click("Record voice note");
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    v.rerender(<ChatView {...p} />);
    await act(async () => click("Record voice note"));
    act(() => vi.advanceTimersByTime(60_000));
    expect(Recorder.latest.stop).toHaveBeenCalledOnce();
  });
  it("uses browser speech recognition when recorded audio is unavailable", async () => {
    const p = props();
    vi.stubGlobal("SpeechRecognition", Recognition);
    const v = render(<ChatView {...without(p, "onVoiceRecording")} />);
    click("Record voice note");
    expect(Recognition.latest.lang).toBe("en-IN");
    act(() =>
      Recognition.latest.onresult?.({
        results: [{ 0: { transcript: "A spoken note" } }, {}],
      }),
    );
    expect(screen.getByText("A spoken note")).toBeTruthy();
    click("Stop recording voice note");
    await waitFor(() =>
      expect(p.onVoiceNote).toHaveBeenCalledWith("A spoken note"),
    );
    for (const cause of [Error("Speech failed"), "offline"]) {
      p.onVoiceNote.mockRejectedValueOnce(cause);
      click("Record voice note");
      act(() =>
        Recognition.latest.onresult?.({
          results: [{ 0: { transcript: "Retry" } }],
        }),
      );
      click("Stop recording voice note");
      await screen.findByText(
        cause instanceof Error ? cause.message : "Voice note failed.",
      );
    }
    click("Record voice note");
    act(() => Recognition.latest.onerror?.());
    expect(screen.getByText(/couldn’t access/)).toBeTruthy();
    click("Record voice note");
    const recognition = Recognition.latest;
    v.unmount();
    act(() => {
      recognition.onresult?.({ results: [] });
      recognition.onerror?.();
      recognition.onend?.();
    });
    expect(recognition.abort).toHaveBeenCalled();
  });
  it("handles WebKit recognition timeout and browsers without transcription", async () => {
    const p = props();
    vi.stubGlobal("SpeechRecognition", undefined);
    vi.stubGlobal("webkitSpeechRecognition", undefined);
    const v = render(<ChatView {...without(p, "onVoiceRecording")} />);
    click("Record voice note");
    expect(screen.getByText(/not available in this browser/)).toBeTruthy();
    vi.stubGlobal("webkitSpeechRecognition", Recognition);
    vi.useFakeTimers();
    click("Record voice note");
    act(() => vi.advanceTimersByTime(60_000));
    expect(Recognition.latest.stop).toHaveBeenCalledOnce();
    expect(p.onVoiceNote).not.toHaveBeenCalled();
    v.unmount();
  });
});
