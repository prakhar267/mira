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
import { CameraConversationModal } from "./CameraConversationModal";
import { dialogSupport } from "../tests/ui-test-helpers";
const click = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));
const stop = vi.fn(),
  stream = { getTracks: () => [{ stop }] },
  draw = vi.fn(),
  getUserMedia = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  dialogSupport();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  getUserMedia.mockResolvedValue(stream);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: draw,
  } as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/jpeg;base64,FRAME",
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("camera consent and lifecycle", () => {
  it("attaches the permitted stream to the rendered preview and uploads only an explicit still frame", async () => {
    const start = vi.fn().mockResolvedValue(undefined),
      analyze = vi.fn().mockResolvedValue("A drawing on a desk"),
      close = vi.fn();
    const v = render(
      <CameraConversationModal
        companionName="Mira"
        onSessionStart={start}
        onAnalyzeFrame={analyze}
        onClose={close}
      />,
    );
    expect(getUserMedia).not.toHaveBeenCalled();
    click("Allow camera");
    const video = (await screen.findByLabelText(
      "Local camera preview",
    )) as HTMLVideoElement;
    expect(video.srcObject).toBe(stream);
    expect(getUserMedia).toHaveBeenCalledWith({ video: true, audio: false });
    expect(analyze).not.toHaveBeenCalled();
    Object.defineProperty(video, "videoWidth", { value: 640 });
    Object.defineProperty(video, "videoHeight", { value: 480 });
    click("Discuss this frame");
    await screen.findByText("A drawing on a desk");
    expect(analyze).toHaveBeenCalledWith("FRAME", "image/jpeg");
    expect(draw).toHaveBeenCalledWith(video, 0, 0, 640, 480);
    click("End camera session");
    expect(close).toHaveBeenCalledOnce();
    v.unmount();
    expect(stop).toHaveBeenCalled();
  });
  it("stops a late permission result after closure", async () => {
    let resolve!: (value: unknown) => void;
    getUserMedia.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const v = render(
      <CameraConversationModal companionName="Mira" onClose={vi.fn()} />,
    );
    click("Allow camera");
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    v.unmount();
    await act(async () => resolve(stream));
    expect(stop).toHaveBeenCalledOnce();
  });
  it("does not request hardware after session startup resolves on a closed modal", async () => {
    let resolve!: () => void;
    const start = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    const v = render(
      <CameraConversationModal
        companionName="Mira"
        onSessionStart={start}
        onClose={vi.fn()}
      />,
    );
    click("Allow camera");
    v.unmount();
    await act(async () => resolve());
    expect(getUserMedia).not.toHaveBeenCalled();
  });
  it("handles permission denial and leaves frame sharing unavailable without an analyzer", async () => {
    getUserMedia.mockRejectedValueOnce(Error("denied"));
    render(<CameraConversationModal companionName="Mira" onClose={vi.fn()} />);
    click("Allow camera");
    await screen.findByText(/Camera permission was declined/);
    click("Allow camera");
    await screen.findByLabelText("Local camera preview");
    expect(
      (
        screen.getByRole("button", {
          name: "Discuss this frame",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
  it.each([Error("Vision unavailable"), "offline"])(
    "reports analysis failures without hiding the preview: %s",
    async (cause) => {
      const analyze = vi.fn().mockRejectedValue(cause);
      render(
        <CameraConversationModal
          companionName="Mira"
          onAnalyzeFrame={analyze}
          onClose={vi.fn()}
        />,
      );
      click("Allow camera");
      await screen.findByLabelText("Local camera preview");
      click("Discuss this frame");
      await screen.findByText(
        cause instanceof Error
          ? cause.message
          : "The frame could not be discussed.",
      );
      expect(screen.getByLabelText("Local camera preview")).toBeTruthy();
    },
  );
});
