import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { streamSpeechMedia } from "./streamed-speech-media";
class BufferSource extends EventTarget {
  appendBuffer = vi.fn(() =>
    queueMicrotask(() => this.dispatchEvent(new Event("updateend"))),
  );
}
class Media extends EventTarget {
  static latest: Media;
  static supported = true;
  static isTypeSupported = () => Media.supported;
  buffer = new BufferSource();
  endOfStream = vi.fn();
  addSourceBuffer = vi.fn(() => this.buffer);
  constructor() {
    super();
    Media.latest = this;
  }
}
const createObjectURL = vi.fn(() => "blob:qa"),
  revokeObjectURL = vi.fn();
const response = (
  body: BodyInit | null = new Uint8Array([73, 68, 51, 1]),
  stream = true,
) =>
  new Response(body, {
    headers: {
      "content-type": "audio/mpeg",
      ...(stream ? { "x-mira-audio-stream": "mp3" } : {}),
    },
  });
beforeEach(() => {
  vi.clearAllMocks();
  Media.supported = true;
  vi.stubGlobal("MediaSource", Media);
  vi.stubGlobal("window", { URL: { createObjectURL, revokeObjectURL } });
});
afterEach(() => vi.unstubAllGlobals());
it("appends a streamed response once, exposes buffered audio and frees the object URL", async () => {
  const audio = { src: "" } as HTMLAudioElement,
    buffered = vi.fn();
  const media = streamSpeechMedia(
    audio,
    response(),
    new AbortController().signal,
    buffered,
  );
  expect(media.streaming).toBe(true);
  expect(audio.src).toBe("blob:qa");
  Media.latest.dispatchEvent(new Event("sourceopen"));
  const blob = await media.done;
  expect(blob.size).toBe(4);
  expect(buffered).toHaveBeenCalledWith(expect.any(Blob));
  expect(Media.latest.buffer.appendBuffer).toHaveBeenCalledOnce();
  expect(Media.latest.endOfStream).toHaveBeenCalledOnce();
  media.dispose();
  media.dispose();
  expect(revokeObjectURL).toHaveBeenCalledOnce();
});
it("buffers the same response when MSE is unsupported or streaming is absent", async () => {
  for (const supported of [false, true]) {
    Media.supported = supported;
    const audio = { src: "" } as HTMLAudioElement;
    const media = streamSpeechMedia(
      audio,
      response(new Uint8Array([1, 2, 3]), !supported),
      new AbortController().signal,
    );
    expect(media.streaming).toBe(false);
    expect((await media.done).size).toBe(3);
    expect(audio.src).toBe("blob:qa");
    media.dispose();
  }
  vi.stubGlobal("MediaSource", undefined);
  const media = streamSpeechMedia(
    { src: "" } as HTMLAudioElement,
    new Response(new Uint8Array([1])),
    new AbortController().signal,
  );
  expect((await media.done).size).toBe(1);
  media.dispose();
});
it.each(["no body", "empty", "too large"])(
  "rejects %s audio without leaking a reader",
  async (kind) => {
    const media = streamSpeechMedia(
      { src: "" } as HTMLAudioElement,
      response(
        kind === "no body"
          ? null
          : new Uint8Array(kind === "empty" ? 0 : 8_000_001),
        false,
      ),
      new AbortController().signal,
    );
    await expect(media.done).rejects.toThrow(
      /no audio|empty audio|exceeds limit/,
    );
    media.dispose();
  },
);
it.each([
  "opening error",
  "append error",
  "append throw",
  "already aborted",
  "opening aborted",
])("cleans event listeners after %s", async (kind) => {
  const controller = new AbortController();
  if (kind === "already aborted") controller.abort(Error("Canceled"));
  const media = streamSpeechMedia(
    { src: "" } as HTMLAudioElement,
    response(),
    controller.signal,
  );
  const result = expect(media.done).rejects.toThrow();
  if (kind === "opening error") Media.latest.dispatchEvent(new Event("error"));
  else if (kind === "opening aborted") controller.abort(Error("Canceled"));
  else if (kind !== "already aborted") {
    Media.latest.buffer.appendBuffer.mockImplementationOnce(() => {
      if (kind === "append throw") throw Error("Append failed");
      queueMicrotask(() =>
        Media.latest.buffer.dispatchEvent(new Event("error")),
      );
    });
    Media.latest.dispatchEvent(new Event("sourceopen"));
  }
  await result;
  media.dispose();
});
it("cancels a pending stream read when disposed", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream({ pull() {}, cancel });
  const media = streamSpeechMedia(
    { src: "" } as HTMLAudioElement,
    response(body),
    new AbortController().signal,
  );
  Media.latest.dispatchEvent(new Event("sourceopen"));
  await Promise.resolve();
  const result = expect(media.done).rejects.toThrow("Speech canceled");
  media.dispose();
  await result;
  expect(cancel).toHaveBeenCalledOnce();
});
