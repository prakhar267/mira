// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { companionApi as api, type SignupInput } from "./api-client";
import { accountClient, AccountClientError } from "./account-client";
import { freshDemo } from "./demo-storage";
const fetcher = vi.fn<typeof fetch>();
const tokens = {
  accessToken: "synthetic-access",
  refreshToken: "synthetic-refresh",
};
const key = "luma.production-session.v1";
const ok = (data: unknown = { accepted: true }) =>
  Response.json({ ok: true, data, requestId: "synthetic" });
const failure = (message = "Rejected", status = 400) =>
  Response.json({ ok: false, error: { code: "TEST", message } }, { status });
beforeEach(() => {
  localStorage.clear();
  fetcher.mockReset().mockImplementation(async () => ok());
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("optional platform HTTP contract", () => {
  const reads: [string, () => Promise<unknown>][] = [
    ["/users/me", () => api.me()],
    ["/companions", () => api.companions()],
    ["/conversations", () => api.conversations()],
    ["/conversations/c/messages", () => api.messages("c")],
    ["/memories", () => api.memories()],
    ["/activities", () => api.activities()],
    ["/wallet", () => api.wallet()],
    ["/wallet/transactions", () => api.walletTransactions()],
    ["/store", () => api.store()],
    ["/inventory", () => api.inventory()],
    ["/subscriptions", () => api.subscription()],
    ["/journal", () => api.journal()],
    ["/events", () => api.events()],
    ["/notifications/planned", () => api.nudges()],
    ["/notifications/preferences", () => api.notifications()],
    ["/calls", () => api.calls()],
    ["/moments", () => api.moments()],
    ["/photos", () => api.photos()],
  ];
  it.each(reads)(
    "reads %s with the stored bearer and propagates the server envelope",
    async (path, read) => {
      localStorage.setItem(key, JSON.stringify(tokens));
      expect(await read()).toEqual({ accepted: true });
      const [url, init] = fetcher.mock.calls[0]!;
      expect(String(url)).toBe(`http://127.0.0.1:4000${path}`);
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer synthetic-access",
      );
    },
  );
  const mutations: [
    string,
    string,
    () => Promise<unknown>,
    Record<string, unknown> | undefined,
  ][] = [
    [
      "/auth/forgot-password",
      "POST",
      () => api.forgotPassword("qa@example.test"),
      { email: "qa@example.test" },
    ],
    [
      "/auth/reset-password",
      "POST",
      () => api.resetPassword("token", "new password"),
      { token: "token", password: "new password" },
    ],
    [
      "/auth/verify-email",
      "POST",
      () => api.verifyEmail("token"),
      { token: "token" },
    ],
    [
      "/users/me",
      "PATCH",
      () => api.updateUser({ name: "QA" }),
      { name: "QA" },
    ],
    [
      "/companions/c",
      "PATCH",
      () => api.updateCompanion("c", { name: "Asha" }),
      { name: "Asha" },
    ],
    [
      "/companions/c/personality",
      "PATCH",
      () => api.updatePersonality("c", { warmth: 40 }),
      { warmth: 40 },
    ],
    [
      "/conversations",
      "POST",
      () => api.createConversation("c"),
      { companionId: "c" },
    ],
    [
      "/conversations/c",
      "DELETE",
      () => api.deleteConversation("c"),
      undefined,
    ],
    [
      "/memories/m",
      "PATCH",
      () => api.updateMemory("m", { pinned: true }),
      { pinned: true },
    ],
    [
      "/memories",
      "POST",
      () => api.createMemory("c", "goal", "Draw more"),
      { companionId: "c", type: "goal", content: "Draw more", pinned: false },
    ],
    ["/memories/m", "DELETE", () => api.deleteMemory("m"), undefined],
    ["/activities/a/complete", "POST", () => api.completeActivity("a"), {}],
    ["/store/purchase", "POST", () => api.purchaseItem("i"), { itemId: "i" }],
    ["/inventory/i/equip", "POST", () => api.equipItem("i"), undefined],
    [
      "/subscriptions/mock-upgrade",
      "POST",
      () => api.mockUpgrade("free"),
      { planId: "free" },
    ],
    [
      "/journal",
      "POST",
      () => api.addJournal({ title: "Art", content: "I drew", mood: "calm" }),
      { title: "Art", content: "I drew", mood: "calm", tags: [] },
    ],
    ["/journal/j", "DELETE", () => api.deleteJournal("j"), undefined],
    ["/journal/j/reflect", "POST", () => api.reflectJournal("j"), undefined],
    [
      "/events",
      "POST",
      () => api.addEvent("Drawing", "2026-10-01"),
      { description: "Drawing", eventDate: "2026-10-01", status: "confirmed" },
    ],
    [
      "/notifications/preferences",
      "PATCH",
      () => api.updateNotifications({ enabled: false } as never),
      { enabled: false },
    ],
    [
      "/conversations/c/messages/m/feedback",
      "PATCH",
      () => api.feedback("c", "m", "down", "Please listen"),
      { feedback: "down", note: "Please listen" },
    ],
    [
      "/conversations/c/messages/m/regenerate",
      "POST",
      () => api.regenerate("c", "m", false),
      { memoryEnabled: false },
    ],
    [
      "/voice/synthesize",
      "POST",
      () => api.synthesize("Hello", "Priya"),
      { text: "Hello", voiceId: "Priya" },
    ],
    [
      "/voice/transcribe",
      "POST",
      () => api.transcribe("audio", "audio/wav"),
      { audioBase64: "audio", contentType: "audio/wav" },
    ],
    ["/camera/session", "POST", () => api.startCameraSession(), undefined],
    [
      "/media/analyze",
      "POST",
      () => api.analyzeImage("bytes", "image/png", "Describe"),
      { dataBase64: "bytes", contentType: "image/png", prompt: "Describe" },
    ],
    [
      "/media/upload",
      "POST",
      () => api.uploadImage("photo", "image/png", "bytes"),
      { name: "photo", contentType: "image/png", dataBase64: "bytes" },
    ],
    [
      "/media/generate",
      "POST",
      () => api.generateImage("Trees", "warm"),
      { prompt: "Trees", appearance: "warm" },
    ],
    ["/data/export", "POST", () => api.exportData(), undefined],
  ];
  it.each(mutations)(
    "submits %s with %s and the intended payload",
    async (path, method, send, body) => {
      expect(await send()).toEqual({ accepted: true });
      const [url, init] = fetcher.mock.calls[0]!;
      expect(String(url)).toBe(`http://127.0.0.1:4000${path}`);
      expect(init?.method).toBe(method);
      if (body) expect(JSON.parse(String(init?.body))).toMatchObject(body);
      else expect(init?.body).toBeUndefined();
      if (/complete|purchase|mock-upgrade/.test(path))
        expect(JSON.parse(String(init?.body)).idempotencyKey).toMatch(/^web:/);
    },
  );
  it("keeps operator credentials in headers, serializes optional feedback, and clears deleted/logged-out sessions even on failures", async () => {
    for (const invoke of [
      api.adminMetrics,
      api.adminProviders,
      api.adminFlags,
    ]) {
      await invoke("synthetic-admin");
      expect(
        new Headers(fetcher.mock.calls.at(-1)![1]!.headers).get("x-admin-key"),
      ).toBe("synthetic-admin");
    }
    await api.updateAdminFlags("synthetic-admin", { enabled: false });
    expect(JSON.parse(String(fetcher.mock.calls.at(-1)![1]!.body))).toEqual({
      enabled: false,
    });
    await api.feedback("c", "m", "up");
    expect(JSON.parse(String(fetcher.mock.calls.at(-1)![1]!.body))).toEqual({
      feedback: "up",
    });
    localStorage.setItem(key, JSON.stringify(tokens));
    fetcher.mockRejectedValueOnce(Error("offline"));
    await expect(api.logout()).rejects.toThrow("offline");
    expect(api.hasSession()).toBe(false);
    localStorage.setItem(key, JSON.stringify(tokens));
    fetcher.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await api.deleteAccount("DELETE");
    expect(api.hasSession()).toBe(false);
  });
  it("stores successful signup/login sessions and replaces expired access tokens exactly once", async () => {
    fetcher.mockResolvedValueOnce(ok(tokens));
    await api.signup({ email: "qa@example.test" } as SignupInput);
    expect(api.hasSession()).toBe(true);
    api.clearSession();
    fetcher.mockResolvedValueOnce(ok(tokens));
    await api.login("qa@example.test", "password");
    expect(api.hasSession()).toBe(true);
    fetcher
      .mockResolvedValueOnce(failure("expired", 401))
      .mockResolvedValueOnce(
        ok({ accessToken: "renewed", refreshToken: "next" }),
      )
      .mockResolvedValueOnce(ok({ id: "qa" }));
    expect(await api.me()).toEqual({ id: "qa" });
    expect(
      new Headers(fetcher.mock.calls.at(-1)![1]!.headers).get("authorization"),
    ).toBe("Bearer renewed");
    fetcher
      .mockResolvedValueOnce(failure("expired", 401))
      .mockResolvedValueOnce(failure("bad refresh", 401));
    await expect(api.me()).rejects.toThrow("expired");
    expect(api.hasSession()).toBe(false);
  });
  it("does not retry forever, rejects invalid envelopes, and tolerates corrupt or absent browser storage", async () => {
    localStorage.setItem(key, "{");
    expect(api.hasSession()).toBe(false);
    fetcher.mockResolvedValueOnce(Response.json({ ok: true }, { status: 503 }));
    await expect(api.me()).rejects.toThrow("503");
    localStorage.setItem(key, JSON.stringify(tokens));
    fetcher
      .mockResolvedValueOnce(failure("expired", 401))
      .mockResolvedValueOnce(ok(tokens))
      .mockResolvedValueOnce(failure("still expired", 401));
    await expect(api.me()).rejects.toThrow("still expired");
    vi.stubGlobal("window", undefined);
    expect(api.hasSession()).toBe(false);
    api.clearSession();
    fetcher.mockResolvedValueOnce(ok(tokens));
    await api.login("qa", "password");
  });
});

describe("edge adapters and streaming", () => {
  it("sends only approved memory fields and validates malformed or failed responses", async () => {
    const memory = {
      id: "m",
      content: "I like drawing",
      importance: 2,
      pinned: true,
      updatedAt: "2026-09-26",
      retrievalCount: 0,
      sourceMessageIds: ["private-source"],
    } as Parameters<typeof api.semanticMemories>[1][number];
    fetcher.mockResolvedValueOnce(
      Response.json({ matches: [], model: "synthetic" }),
    );
    expect(await api.semanticMemories("drawing", [memory], 2)).toEqual({
      matches: [],
      model: "synthetic",
    });
    expect(
      JSON.parse(String(fetcher.mock.calls.at(-1)![1]!.body)).memories[0],
    ).not.toHaveProperty("sourceMessageIds");
    fetcher.mockResolvedValueOnce(Response.json({ matches: [] }));
    expect((await api.semanticMemories("x", [])).model).toBe("unknown");
    for (const response of [
      new Response("bad"),
      Response.json({ error: "Forbidden" }, { status: 403 }),
    ]) {
      fetcher.mockResolvedValueOnce(response);
      await expect(api.semanticMemories("x", [])).rejects.toThrow();
    }
  });
  it("propagates transcription cancellation and server errors", async () => {
    const signal = new AbortController().signal;
    fetcher.mockResolvedValueOnce(Response.json({ text: "Hello" }));
    expect(await api.edgeTranscribe("bytes", "audio/wav", signal)).toEqual({
      text: "Hello",
      durationMs: 0,
    });
    expect(fetcher.mock.calls.at(-1)![1]?.signal).toBe(signal);
    for (const response of [
      Response.json({ error: "Denied" }, { status: 403 }),
      new Response("invalid"),
    ]) {
      fetcher.mockResolvedValueOnce(response);
      await expect(api.edgeTranscribe("bytes", "audio/wav")).rejects.toThrow();
    }
  });
  it("consumes fragmented event streams and surfaces explicit stream or HTTP failures", async () => {
    const input = {
        conversationId: "c",
        companionId: "m",
        content: "Hello",
        clientMessageId: "u",
      },
      delta = vi.fn(),
      signal = new AbortController().signal;
    const bytes = new TextEncoder().encode(
      'event: token\ndata: {"delta":"Hello"}\n\nevent: ping\n\nevent: token\ndata: {}\n\nevent: done\ndata: {"assistantMessageId":"a"}\n\n',
    );
    fetcher.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes.slice(0, 14));
            controller.enqueue(bytes.slice(14));
            controller.close();
          },
        }),
      ),
    );
    expect(await api.streamChat(input, delta, signal)).toEqual({
      assistantMessageId: "a",
    });
    expect(delta).toHaveBeenCalledWith("Hello");
    expect(fetcher.mock.calls.at(-1)![1]?.signal).toBe(signal);
    for (const response of [
      failure("Denied", 403),
      new Response("bad", { status: 503 }),
      new Response(null),
      new Response('event: error\ndata: {"message":"Failed"}\n\n'),
      new Response("event: error\ndata: {}\n\n"),
    ]) {
      fetcher.mockResolvedValueOnce(response);
      await expect(api.streamChat(input, delta)).rejects.toThrow();
    }
  });
});

describe("Cloudflare account client", () => {
  it("sends account mutations with same-origin credentials and preserves revisions and cancellation", async () => {
    const state = freshDemo(),
      signal = new AbortController().signal;
    const work = [
      () => accountClient.login("qa", "password"),
      () =>
        accountClient.signup({
          email: "qa@example.test",
          password: "password",
          name: "QA",
          state,
          policy: {
            termsVersion: "2026-09-13",
            adultConfirmed: true,
            aiProcessingConsent: true,
          },
        }),
      () => accountClient.load(),
      () => accountClient.load(signal),
      () => accountClient.save(state, 3),
      () => accountClient.save(state, 3, signal),
      () => accountClient.memory({ action: "forget", id: "m" }, 3),
      () => accountClient.conversation({ action: "create" }, 3),
      () =>
        accountClient.acceptPolicy(
          {
            termsVersion: "2026-09-13",
            adultConfirmed: true,
            aiProcessingConsent: true,
            memoryEnabled: false,
            conversationStorageEnabled: true,
          },
          3,
        ),
      () => accountClient.reauthenticate("password"),
      () => accountClient.messages(),
      () => accountClient.messages("cursor &", "conversation &"),
      () => accountClient.logout(),
      () => accountClient.exportData(),
      () => accountClient.deleteAccount(),
    ];
    fetcher.mockImplementation(async () => Response.json({ accepted: true }));
    for (const invoke of work) {
      expect(await invoke()).toEqual({ accepted: true });
      expect(fetcher.mock.calls.at(-1)![1]).toMatchObject({
        credentials: "same-origin",
        cache: "no-store",
      });
    }
    const paginated = fetcher.mock.calls.find(([url]) =>
      String(url).includes("cursor="),
    )!;
    expect(String(paginated[0])).toContain(
      "cursor=cursor+%26&conversationId=conversation+%26",
    );
    fetcher.mockResolvedValueOnce(
      Response.json(
        { error: "Reload", code: "STATE_CONFLICT", revision: 4 },
        { status: 409 },
      ),
    );
    await expect(accountClient.save(state, 3)).rejects.toMatchObject({
      status: 409,
      code: "STATE_CONFLICT",
      revision: 4,
    });
    fetcher.mockResolvedValueOnce(new Response("invalid", { status: 503 }));
    await expect(accountClient.load()).rejects.toBeInstanceOf(
      AccountClientError,
    );
    fetcher.mockResolvedValueOnce(Response.json({}, { status: 404 }));
    await expect(accountClient.load()).rejects.toThrow("404");
  });
});

describe("realtime media resource ownership", () => {
  function hardware() {
    const stop = vi.fn(),
      track = { stop },
      media = { getTracks: () => [track] };
    const channel = { close: vi.fn() };
    const peer = {
      ontrack: null as null | ((event: { streams: unknown[] }) => void),
      addTrack: vi.fn(),
      createDataChannel: vi.fn(() => channel),
      createOffer: vi.fn(async () => ({ sdp: "synthetic-offer" })),
      setLocalDescription: vi.fn(),
      setRemoteDescription: vi.fn(),
      close: vi.fn(),
    };
    vi.stubGlobal(
      "RTCPeerConnection",
      class {
        constructor() {
          return peer;
        }
      },
    );
    vi.stubGlobal(
      "Audio",
      class {
        srcObject = null;
        autoplay = false;
      },
    );
    const getUserMedia = vi.fn().mockResolvedValue(media);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    return { peer, channel, media, stop, getUserMedia };
  }
  it.each([null, 1, {}, { value: 3 }, "mock-qa"])(
    "rejects unavailable client credentials (%j) and ends the opened server call",
    async (secret) => {
      fetcher
        .mockResolvedValueOnce(ok({ clientSecret: secret, callId: "call" }))
        .mockRejectedValueOnce(Error("offline"));
      await expect(api.connectRealtime("voice", "c")).rejects.toThrow(
        /fallback/,
      );
      expect(String(fetcher.mock.calls.at(-1)![0])).toContain(
        "/calls/call/end",
      );
    },
  );
  it.each(["voice", "video"] as const)(
    "connects %s media and releases owned resources on disconnect",
    async (kind) => {
      const { peer, channel, media, stop } = hardware();
      fetcher
        .mockResolvedValueOnce(
          ok(
            kind === "voice"
              ? { clientSecret: "synthetic-secret", callId: "call" }
              : {
                  id: "call",
                  realtime: { clientSecret: { value: "synthetic-secret" } },
                },
          ),
        )
        .mockResolvedValueOnce(new Response("synthetic-answer"));
      const connected = await api.connectRealtime(kind, "c");
      expect(peer.addTrack).toHaveBeenCalledWith(media.getTracks()[0], media);
      expect(peer.setRemoteDescription).toHaveBeenCalledWith({
        type: "answer",
        sdp: "synthetic-answer",
      });
      peer.ontrack!({ streams: [media] });
      expect(connected.audio.srcObject).toBe(media);
      peer.ontrack!({ streams: [] });
      expect(connected.audio.srcObject).toBeNull();
      connected.disconnect();
      connected.disconnect();
      expect(stop).toHaveBeenCalledTimes(1);
      expect(peer.close).toHaveBeenCalledTimes(1);
      expect(channel.close).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["permission", "offer", "local", "network", "status", "remote"])(
    "cleans up a realtime failure during %s",
    async (phase) => {
      const { peer, channel, getUserMedia, stop } = hardware();
      fetcher.mockResolvedValueOnce(
        ok({ clientSecret: { value: "synthetic-secret" }, callId: "call" }),
      );
      if (phase === "permission")
        getUserMedia.mockRejectedValueOnce(Error("permission denied"));
      if (phase === "offer")
        peer.createOffer.mockRejectedValueOnce(Error("offer failed"));
      if (phase === "local")
        peer.setLocalDescription.mockRejectedValueOnce(Error("local failed"));
      if (phase === "network")
        fetcher.mockRejectedValueOnce(Error("network failed"));
      else
        fetcher.mockResolvedValueOnce(
          new Response("answer", { status: phase === "status" ? 503 : 200 }),
        );
      if (phase === "remote")
        peer.setRemoteDescription.mockRejectedValueOnce(Error("remote failed"));
      await expect(api.connectRealtime("voice", "c")).rejects.toThrow();
      expect(peer.close).toHaveBeenCalledTimes(1);
      if (phase !== "permission") expect(stop).toHaveBeenCalledTimes(1);
      if (!["permission", "offer"].includes(phase))
        expect(channel.close).toHaveBeenCalledTimes(1);
    },
  );
});
