import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  account: vi.fn(),
  authorize: vi.fn(),
  store: vi.fn(),
  rate: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
  fetch: vi.fn(),
  ai: vi.fn(),
  env: { INWORLD_API_KEY: "synthetic" },
}));
vi.mock("cloudflare:workers", () => ({
  env: {
    get INWORLD_API_KEY() {
      return mocks.env.INWORLD_API_KEY;
    },
    AI: { run: mocks.ai },
  },
}));
vi.mock("./account-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./account-server")>()),
  requireAccount: mocks.account,
}));
vi.mock("./edge-security", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./edge-security")>()),
  edgeRateLimited: mocks.rate,
}));
vi.mock("./cloud-store", () => ({
  CloudStoreError: class extends Error {},
  storeAction: mocks.store,
  cloudStore: { get: mocks.get, put: mocks.put },
}));
vi.mock("./inference-policy", () => ({ authorizeInference: mocks.authorize }));
vi.mock("./provider-fetch", () => ({ providerFetch: mocks.fetch }));
vi.mock("./capacity", () => ({
  withInferenceCapacity: (
    _service: string,
    _principal: unknown,
    _units: number,
    work: () => unknown,
  ) => work(),
}));
import { GET as search } from "../app/api/account/search/route";
import { GET as voices } from "../app/api/voices/route";
import { GET as preview } from "../app/api/voices/preview/route";
import { POST as reflect } from "../app/api/journal-reflection/route";
import {
  GET as reminders,
  POST as updateReminders,
} from "../app/api/account/reminders/route";
import { AccountError } from "./account-server";
import { EdgeRequestError } from "./edge-security";
import { DEFAULT_REMINDER } from "./reminders";
import { freshDemo } from "./demo-storage";
import type { JournalEntryRecord } from "@companion/shared";
const request = (path = "", payload?: unknown, headers = {}) =>
  new Request(`https://mira.test/api/${path}`, {
    ...(payload !== undefined
      ? {
          method: "POST",
          body: JSON.stringify(payload),
          headers: { "content-type": "application/json", ...headers },
        }
      : { headers }),
  });
const entry: JournalEntryRecord = {
  id: "j",
  userId: "u",
  title: "Painting",
  content: "I painted a tree.",
  mood: "calm",
  tags: [],
  reflected: false,
  createdAt: "2026-09-24T10:00:00Z",
  updatedAt: "2026-09-24T10:00:00Z",
};
const selection = { entryIds: ["j"], entries: [entry] };
const rule = { ...DEFAULT_REMINDER, kind: "daily", id: "daily" };
const device = {
  endpoint: "https://fcm.googleapis.com/synthetic",
  keys: {
    p256dh: btoa(String.fromCharCode(4) + "x".repeat(64)).replace(/=/g, ""),
    auth: "a".repeat(22),
  },
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.env.INWORLD_API_KEY = "synthetic";
  mocks.account.mockResolvedValue({ account: { id: "owner" } });
  mocks.authorize.mockResolvedValue({ mode: "demo", id: "demo" });
  mocks.rate.mockResolvedValue(false);
  mocks.store.mockResolvedValue({ messages: [] });
  mocks.get.mockResolvedValue(null);
});
describe("account search API", () => {
  it("passes every validated filter with the authenticated owner and no-store", async () => {
    const options = {
      q: "  café  ",
      conversationId: "c",
      role: "assistant",
      from: "2026-09-20T00:00:00.000Z",
      to: "2026-09-25T00:00:00.000Z",
      cursor: JSON.stringify(["2026-09-24", "m"]),
    };
    const result = await search(
      request(`search?${new URLSearchParams(options)}`),
    );
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(mocks.store).toHaveBeenCalledWith({
      action: "transcriptSearch",
      userId: "owner",
      options: {
        query: "café",
        conversationId: "c",
        role: "assistant",
        from: options.from,
        to: options.to,
        before: options.cursor,
      },
    });
    await search(request("search?messageId=c:message"));
    expect(mocks.store).toHaveBeenLastCalledWith({
      action: "transcriptContext",
      userId: "owner",
      messageId: "c:message",
    });
    expect((await search(request("search?q=hi"))).status).toBe(200);
  });
  it.each([
    "",
    "q=x",
    `q=${"a".repeat(121)}`,
    "messageId=../other",
    "q=hi&conversationId=../x",
    "q=hi&role=system",
    "q=hi&cursor=bad",
    "q=hi&cursor={}",
    "q=hi&cursor=[1,2]",
    "q=hi&cursor=[]",
    `q=hi&cursor=${encodeURIComponent(JSON.stringify(["x".repeat(301), "m"]))}`,
    "q=hi&from=2026-09-24",
    "q=hi&to=2026-99-99T00:00:00.000Z",
  ])("rejects invalid query %s before reading transcripts", async (query) => {
    expect((await search(request(`search?${query}`))).status).toBe(400);
    expect(mocks.store).not.toHaveBeenCalled();
  });
  it("requires a session and rate-limits authenticated searches", async () => {
    mocks.account.mockRejectedValueOnce(new AccountError("Sign in", 401));
    expect((await search(request("search?q=hi"))).status).toBe(401);
    mocks.rate.mockResolvedValue(true);
    expect((await search(request("search?q=hi"))).status).toBe(429);
    expect(mocks.store).not.toHaveBeenCalled();
  });
});
describe("voice API", () => {
  const audio = btoa("ID3synthetic-preview");
  it("returns catalogue and legacy/default selection without a provider synthesis call", async () => {
    mocks.get.mockResolvedValue(JSON.stringify([{ id: "Priya" }]));
    const result = await voices(request("voices"));
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      selected: "Priya",
      voices: [{ id: "Priya" }],
    });
    mocks.authorize.mockResolvedValue({
      mode: "account",
      id: "u",
      state: { companion: { voiceId: "Ashley" } },
    });
    expect(await (await voices(request("voices"))).json()).toMatchObject({
      selected: "Ashley",
    });
    expect(mocks.ai).not.toHaveBeenCalled();
  });
  it.each([voices, preview])(
    "blocks unavailable configuration, rate limits and revoked consent",
    async (route) => {
      mocks.env.INWORLD_API_KEY = " ";
      expect((await route(request("voices"))).status).toBe(503);
      mocks.env.INWORLD_API_KEY = "key";
      mocks.rate.mockResolvedValue(true);
      expect((await route(request("voices"))).status).toBe(429);
      mocks.rate.mockResolvedValue(false);
      mocks.authorize.mockRejectedValue(
        new EdgeRequestError("Consent required", 403),
      );
      expect((await route(request("voices"))).status).toBe(403);
      expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );
  it("fetches a default preview once, verifies bytes, caches and reauthorizes before delivery", async () => {
    mocks.env.INWORLD_API_KEY = "Basic secret";
    mocks.fetch.mockResolvedValue(Response.json({ audioContent: audio }));
    const result = await preview(request("voices/preview"));
    expect(result.status).toBe(200);
    expect(result.headers.get("content-type")).toBe("audio/mpeg");
    expect(await result.text()).toBe("ID3synthetic-preview");
    expect(mocks.fetch.mock.calls[0]?.[1].headers.authorization).toBe(
      "Basic secret",
    );
    expect(mocks.put).toHaveBeenCalledWith("voice-preview:v1:Priya", audio, {
      expirationTtl: 86400,
    });
    expect(mocks.authorize).toHaveBeenCalledTimes(2);
    mocks.get.mockResolvedValue(audio);
    expect(
      (await preview(request("voices/preview?voiceId=Priya"))).status,
    ).toBe(200);
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });
  it.each([
    {},
    { audioContent: 42 },
    { audioContent: "a".repeat(1_000_001) },
    { audioContent: "!bad!" },
  ])("rejects malformed preview content %j", async (body) => {
    mocks.fetch.mockResolvedValue(Response.json(body));
    expect(
      (await preview(request("voices/preview"))).status,
    ).toBeGreaterThanOrEqual(500);
    expect(mocks.put).not.toHaveBeenCalled();
  });
  it("reports failed upstream, rejects cross-origin requests and fences withdrawn consent", async () => {
    mocks.fetch.mockResolvedValue(new Response(null, { status: 500 }));
    expect((await preview(request("voices/preview"))).status).toBe(503);
    expect(
      (
        await preview(
          request("voices/preview", undefined, { origin: "https://evil.test" }),
        )
      ).status,
    ).toBe(403);
    mocks.get.mockResolvedValue(audio);
    mocks.authorize
      .mockResolvedValueOnce({ id: "demo" })
      .mockRejectedValueOnce(new EdgeRequestError("Withdrawn", 403));
    expect((await preview(request("voices/preview"))).status).toBe(403);
  });
});
describe("selected journal inference API", () => {
  it.each([
    [
      "AiError: daily free allocation of 10,000 neurons exhausted",
      429,
      "PROVIDER_DAILY_QUOTA",
    ],
    ["3040: Capacity temporarily exceeded", 503, "PROVIDER_BUSY"],
  ] as const)(
    "returns a useful provider error without generating again: %s",
    async (message, status, code) => {
      mocks.ai.mockRejectedValueOnce(new Error(message));
      const response = await reflect(request("journal-reflection", selection));
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ code });
      expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(mocks.ai).toHaveBeenCalledOnce();
    },
  );
  it.each([
    { response: "A quiet moment for painting." },
    { choices: [{ message: { content: "A quiet moment for painting." } }] },
  ])("accepts supported provider reply envelopes", async (output) => {
    mocks.ai.mockResolvedValue(output);
    const response = await reflect(request("journal-reflection", selection));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      summary: "A quiet moment for painting.",
      entryIds: ["j"],
      language: "English",
    });
    expect(mocks.ai.mock.calls[0]?.[0]).toBe("@cf/google/gemma-4-26b-a4b-it");
  });
  it("reads a complete stream and rejects interrupted streams", async () => {
    const stream = (text: string) =>
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode(text));
          c.close();
        },
      });
    mocks.ai.mockResolvedValueOnce(
      stream('data: {"response":"You enjoyed painting."}\n\ndata: [DONE]\n\n'),
    );
    expect(
      (await reflect(request("journal-reflection", selection))).status,
    ).toBe(200);
    mocks.ai.mockResolvedValueOnce(
      stream('data: {"response":"unfinished"}\n\n'),
    );
    expect(
      (await reflect(request("journal-reflection", selection))).status,
    ).toBeGreaterThanOrEqual(500);
  });
  it.each([
    {},
    { choices: [] },
    { response: " " },
    { response: 42 },
    { response: "x".repeat(6001) },
    { response: "I am a real human and I live near you." },
    { response: "<script>bad</script>" },
  ])("rejects empty, unsafe and excessive output %j", async (output) => {
    mocks.ai.mockResolvedValue(output);
    expect(
      (await reflect(request("journal-reflection", selection))).status,
    ).toBe(503);
  });
  it("enforces consent, request origin, rate and body limits before inference", async () => {
    expect(
      (
        await reflect(
          request("journal-reflection", selection, {
            origin: "https://evil.test",
          }),
        )
      ).status,
    ).toBe(403);
    mocks.rate.mockResolvedValueOnce(true);
    expect(
      (await reflect(request("journal-reflection", selection))).status,
    ).toBe(429);
    expect(
      (
        await reflect(
          request("journal-reflection", {
            ...selection,
            extra: "x".repeat(110001),
          }),
        )
      ).status,
    ).toBe(413);
    mocks.authorize.mockRejectedValueOnce(
      new EdgeRequestError("AI paused", 403),
    );
    expect(
      (await reflect(request("journal-reflection", selection))).status,
    ).toBe(403);
    expect(mocks.ai).not.toHaveBeenCalled();
  });
  it.each(["identity", "journal", "consent"])(
    "fences %s changes during inference",
    async (change) => {
      const state = freshDemo();
      state.journalEntries = [entry];
      const principal = { mode: "account", id: "owner", state };
      mocks.authorize
        .mockResolvedValueOnce(principal)
        .mockResolvedValueOnce(principal);
      if (change === "consent")
        mocks.authorize.mockRejectedValueOnce(
          new EdgeRequestError("Paused", 403),
        );
      else
        mocks.authorize.mockResolvedValueOnce(
          change === "identity"
            ? { ...principal, id: "other" }
            : {
                ...principal,
                state: {
                  ...state,
                  journalEntries: [{ ...entry, content: "Edited" }],
                },
              },
        );
      mocks.ai.mockResolvedValue({ response: "You made time for painting." });
      const response = await reflect(
        request("journal-reflection", { entryIds: ["j"] }),
      );
      expect(response.status).toBe(change === "consent" ? 403 : 409);
      expect(mocks.ai).toHaveBeenCalledOnce();
    },
  );
});
describe("authenticated reminder API", () => {
  it("returns private metadata and propagates account disappearance", async () => {
    mocks.store
      .mockResolvedValueOnce({ rules: [], devices: [] })
      .mockResolvedValueOnce({ error: "Account unavailable" });
    const response = await reminders(request("account/reminders"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await reminders(request())).status).toBe(401);
  });
  it.each([
    { action: "subscribe", subscription: device },
    { action: "unsubscribe" },
    { action: "unsubscribe", id: "a".repeat(43) },
    { action: "save", rule },
    { action: "delete", id: "daily" },
    { action: "delete", id: "event:plan" },
  ])("uses canonical owner-scoped writes for %j", async (body) => {
    mocks.store.mockResolvedValue({ rules: [], devices: [] });
    const response = await updateReminders(request("account/reminders", body));
    expect(response.status).toBe(200);
    expect(mocks.store).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "owner" }),
    );
    if (body.action === "subscribe")
      expect(mocks.store.mock.calls[0]?.[0].id).toMatch(/^[a-zA-Z0-9_-]{43}$/);
  });
  it.each([
    null,
    [],
    {},
    { action: "subscribe" },
    { action: "unsubscribe", id: 1 },
    { action: "unsubscribe", id: "wrong" },
    { action: "save", rule: null },
    { action: "delete", id: 3 },
    { action: "delete", id: "other-user" },
  ])("rejects invalid writes %j", async (body) => {
    expect(
      (await updateReminders(request("account/reminders", body))).status,
    ).toBe(400);
    expect(mocks.store).not.toHaveBeenCalled();
  });
  it("enforces origin, authentication, rate and payload size and forwards store errors", async () => {
    expect(
      (
        await updateReminders(
          request("account/reminders", {}, { origin: "https://evil.test" }),
        )
      ).status,
    ).toBe(403);
    mocks.account.mockRejectedValueOnce(new AccountError("Sign in", 401));
    expect(
      (await updateReminders(request("account/reminders", {}))).status,
    ).toBe(401);
    mocks.rate.mockResolvedValueOnce(true);
    expect(
      (await updateReminders(request("account/reminders", {}))).status,
    ).toBe(429);
    expect(
      (
        await updateReminders(
          request("account/reminders", { payload: "x".repeat(8001) }),
        )
      ).status,
    ).toBe(413);
    mocks.store.mockResolvedValue({ error: "Enable a device first" });
    expect(
      (
        await updateReminders(
          request("account/reminders", { action: "save", rule }),
        )
      ).status,
    ).toBe(400);
  });
});
