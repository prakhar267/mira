import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  authorize: vi.fn(),
  provider: vi.fn(),
  ai: vi.fn(),
  store: vi.fn(),
  capacity: vi.fn(),
  reserve: vi.fn(),
  release: vi.fn(),
  available: vi.fn(),
}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: mock.env }));
vi.mock("./inference-policy", () => ({ authorizeInference: mock.authorize }));
vi.mock("./provider-fetch", () => ({ providerFetch: mock.provider }));
vi.mock("./cloud-store", () => ({ storeAction: mock.store }));
vi.mock("./capacity", () => ({
  withInferenceCapacity: mock.capacity,
  reserveCapacity: mock.reserve,
}));
vi.mock("./voice-catalog", async (original) => ({
  ...(await original<typeof import("./voice-catalog")>()),
  assertVoiceAvailable: mock.available,
}));
import { POST as speech } from "../app/api/companion-speech/route";
import { POST as transcribe } from "../app/api/companion-transcribe/route";
import { EdgeRequestError } from "./edge-security";
const request = (
  payload: unknown,
  headers: Record<string, string> = {},
  signal?: AbortSignal,
) =>
  new Request("https://mira.test/api/test", {
    method: "POST",
    headers: { origin: "https://mira.test", ...headers },
    body: JSON.stringify(payload),
    ...(signal ? { signal } : {}),
  });
const audio = Buffer.from([73, 68, 51, ...Array(64).fill(0)]).toString(
  "base64",
);
const speechInput = {
  text: "Hello. It is nice to hear from you.",
  voiceId: "Priya",
};
const transcriptionInput = {
  audioBase64: Buffer.alloc(64, 1).toString("base64"),
  contentType: "audio/webm",
  vocabulary: ["Pune"],
};
let epoch = Date.now();
beforeEach(() => {
  vi.resetAllMocks();
  epoch += 60000;
  for (const key of Object.keys(mock.env)) delete mock.env[key];
  Object.assign(mock.env, {
    INWORLD_API_KEY: "synthetic-key",
    AI: { run: mock.ai },
  });
  mock.authorize.mockResolvedValue({
    mode: "demo",
    id: "qa",
    memoryConsent: true,
  });
  mock.store.mockResolvedValue({ limited: false });
  mock.capacity.mockImplementation((_service, _principal, _units, work) =>
    work(),
  );
  mock.reserve.mockResolvedValue(mock.release);
  mock.release.mockResolvedValue(undefined);
  mock.available.mockResolvedValue(undefined);
  vi.spyOn(Date, "now").mockReturnValue(epoch);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());
describe("speech route delivery and consent boundaries", () => {
  it("delivers validated MP3 with selected voice and private response headers", async () => {
    mock.provider.mockResolvedValueOnce(Response.json({ audioContent: audio }));
    const response = await speech(request(speechInput));
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(response.headers.get("x-companion-voice")).toBe("Priya");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect((await response.arrayBuffer()).byteLength).toBe(67);
    expect(mock.authorize).toHaveBeenCalledTimes(3);
  });
  it.each([
    "rate",
    "voice type",
    "unsafe",
    "unconfigured",
    "voice unavailable",
    "empty",
  ])("rejects %s before synthesis", async (kind) => {
    let input: Record<string, unknown> = speechInput;
    if (kind === "rate") mock.store.mockResolvedValueOnce({ limited: true });
    if (kind === "voice type") input = { ...speechInput, voiceId: 3 };
    if (kind === "unsafe")
      input = { text: "I am a real human and I live near you." };
    if (kind === "unconfigured") delete mock.env.INWORLD_API_KEY;
    if (kind === "voice unavailable")
      mock.available.mockRejectedValueOnce(
        new EdgeRequestError("Voice unavailable", 422),
      );
    if (kind === "empty") input = { text: " " };
    const response = await speech(request(input));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(mock.provider).not.toHaveBeenCalled();
  });
  it.each(["http", "missing audio", "bad audio", "network"])(
    "returns an honest synthesis error for %s",
    async (kind) => {
      if (kind === "network")
        mock.provider.mockRejectedValueOnce(
          Error("Synthetic upstream failure"),
        );
      else
        mock.provider.mockResolvedValueOnce(
          kind === "http"
            ? new Response("unavailable", { status: 503 })
            : Response.json(
                kind === "missing audio" ? {} : { audioContent: "not audio" },
              ),
        );
      const response = await speech(request(speechInput));
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain("Synthetic upstream");
    },
  );
  it("streams bounded MP3 frames, rechecks consent and releases capacity", async () => {
    mock.provider.mockResolvedValueOnce(
      new Response(JSON.stringify({ result: { audioContent: audio } }) + "\n"),
    );
    const response = await speech(
      request(speechInput, { "x-mira-audio-stream": "1" }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-mira-audio-stream")).toBe("mp3");
    expect((await response.arrayBuffer()).byteLength).toBe(67);
    await Promise.resolve();
    expect(mock.release).toHaveBeenCalledOnce();
    expect(mock.authorize.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
  it.each(["provider", "no body", "consent", "timeout"])(
    "terminates a speech stream on %s failure",
    async (kind) => {
      if (kind === "timeout")
        mock.provider.mockRejectedValueOnce(
          new DOMException("Synthetic timeout", "TimeoutError"),
        );
      else
        mock.provider.mockResolvedValueOnce(
          kind === "provider"
            ? new Response("unavailable", { status: 503 })
            : kind === "no body"
              ? new Response(null)
              : new Response(
                  JSON.stringify({ result: { audioContent: audio } }) + "\n",
                ),
        );
      if (kind === "consent")
        mock.authorize
          .mockResolvedValueOnce({ mode: "demo", id: "qa" })
          .mockResolvedValueOnce({ mode: "demo", id: "qa" })
          .mockRejectedValueOnce(
            new EdgeRequestError("Consent withdrawn", 403),
          );
      const response = await speech(
        request(speechInput, { "x-mira-audio-stream": "1" }),
      );
      expect(response.status).toBe(200);
      await expect(response.arrayBuffer()).rejects.toThrow(
        "Speech interrupted",
      );
      if (kind === "timeout") expect(mock.release).not.toHaveBeenCalled();
      else expect(mock.release).toHaveBeenCalledOnce();
    },
  );
});
describe("speech recognition provider fallback", () => {
  it.each([
    { text: "Cloudflare transcript" },
    { response: { text: "Cloudflare transcript" } },
    {
      results: {
        channels: [{ alternatives: [{ transcript: "Cloudflare transcript" }] }],
      },
    },
  ])("reads a documented fallback shape: %j", async (result) => {
    delete mock.env.INWORLD_API_KEY;
    mock.ai.mockResolvedValueOnce(result);
    const response = await transcribe(request(transcriptionInput));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      text: "Cloudflare transcript",
    });
    expect(mock.ai).toHaveBeenCalledWith(
      "@cf/openai/whisper-large-v3-turbo",
      expect.objectContaining({
        initial_prompt: expect.stringContaining("Vocabulary: Pune."),
      }),
    );
  });
  it.each([
    null,
    "invalid",
    {},
    { response: {} },
    { results: { channels: [null] } },
    { results: { channels: [{ alternatives: [null] }] } },
    { results: { channels: [{ alternatives: [{ transcript: 1 }] }] } },
  ])("filters empty/malformed fallback output: %j", async (result) => {
    delete mock.env.INWORLD_API_KEY;
    mock.ai.mockResolvedValueOnce(result);
    const response = await transcribe(
      request({ ...transcriptionInput, vocabulary: [] }),
    );
    expect(response.status).toBe(422);
  });
  it.each(["http", "network"])(
    "falls back once after %s transcription failure",
    async (failure) => {
      if (failure === "http")
        mock.provider.mockResolvedValueOnce(
          new Response("unavailable", { status: 503 }),
        );
      else mock.provider.mockRejectedValueOnce(Error("offline"));
      mock.ai.mockResolvedValueOnce({ text: "The preserved transcript" });
      const response = await transcribe(request(transcriptionInput));
      expect(response.status).toBe(200);
      expect(mock.ai).toHaveBeenCalledOnce();
    },
  );
  it.each(["", "Thanks for watching."])(
    "does not cascade after usable provider silence or hallucination: %s",
    async (text) => {
      mock.provider.mockResolvedValueOnce(
        Response.json({ transcription: { transcript: text } }),
      );
      expect((await transcribe(request(transcriptionInput))).status).toBe(422);
      expect(mock.ai).not.toHaveBeenCalled();
    },
  );
  it("bounds script recovery and rejects rate limits, provider failures and aborted inference", async () => {
    mock.provider
      .mockResolvedValueOnce(
        Response.json({ transcription: { transcript: "คุณ" } }),
      )
      .mockResolvedValueOnce(
        Response.json({ transcription: { transcript: "คุณ" } }),
      );
    expect((await transcribe(request(transcriptionInput))).status).toBe(503);
    expect(mock.ai).not.toHaveBeenCalled();
    mock.store.mockResolvedValueOnce({ limited: true });
    expect((await transcribe(request(transcriptionInput))).status).toBe(429);
    delete mock.env.INWORLD_API_KEY;
    mock.ai.mockRejectedValueOnce(Error("Synthetic details"));
    expect((await transcribe(request(transcriptionInput))).status).toBe(503);
    const abort = new AbortController();
    abort.abort();
    expect(
      (await transcribe(request(transcriptionInput, {}, abort.signal))).status,
    ).toBe(503);
  });
});
