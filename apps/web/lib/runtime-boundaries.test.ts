import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { MiraRecoveryDrill } from "./recovery-drill";
import type { SqlStorage } from "./store-engine";
import { operationalAlerts } from "./operations";
import { createRequire } from "./browser-node-module-shim";
import { parseRerankerScores, rankSemanticMemories } from "./semantic-memory";
import { freshDemo } from "./demo-storage";
import {
  parseChatPayload,
  parseMemoryPayload,
  parseTranscriptionPayload,
} from "./inference-payloads";
const mocks = vi.hoisted(() => ({
  store: vi.fn(),
  env: {} as Record<string, unknown>,
}));
vi.mock("./cloud-store", () => ({ storeAction: mocks.store }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
import { reserveCapacity, withInferenceCapacity } from "./capacity";
beforeEach(() => {
  vi.resetAllMocks();
  for (const k of Object.keys(mocks.env)) delete mocks.env[k];
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("synthetic-only recovery drill state machine", () => {
  it("prepares a bookmark, arms a platform restore, restarts and verifies the synthetic marker", async () => {
    const db = new DatabaseSync(":memory:");
    const sql: SqlStorage = {
      exec(query, ...values) {
        const q = db.prepare(query);
        const rows = q.columns().length
          ? q.all(...values)
          : (q.run(...values), []);
        return { toArray: () => rows };
      },
    };
    const sync = vi.fn(async () => {}),
      getCurrentBookmark = vi.fn(async () => "synthetic-bookmark"),
      onNextSessionRestoreBookmark = vi.fn(async () => "synthetic-undo"),
      abort = vi.fn((reason: string): never => {
        throw Error(reason);
      });
    const drill = new MiraRecoveryDrill({
      storage: { sql, sync, getCurrentBookmark, onNextSessionRestoreBookmark },
      abort,
    });
    const call = (action: string) =>
      drill.fetch(
        new Request("https://drill.test", {
          method: "POST",
          body: JSON.stringify({ action }),
        }),
      );
    try {
      expect((await call("arm")).status).toBe(409);
      expect(await (await call("verify")).json()).toEqual({ recovered: false });
      expect((await call("invalid")).status).toBe(400);
      expect(await (await call("prepare")).json()).toEqual({
        prepared: true,
        marker: "synthetic-after",
      });
      expect(sync).toHaveBeenCalledTimes(2);
      expect(await (await call("arm")).json()).toEqual({
        armed: true,
        undoBookmark: "synthetic-undo",
      });
      expect(onNextSessionRestoreBookmark).toHaveBeenCalledWith(
        "synthetic-bookmark",
      );
      await expect(call("restart")).rejects.toThrow("synthetic-only PITR");
      expect(abort).toHaveBeenCalledOnce();
      // Simulate the platform's restore callback, not a real production PITR operation.
      db.exec("UPDATE drill SET value='synthetic-before' WHERE key='marker'");
      expect(await (await call("verify")).json()).toEqual({
        marker: "synthetic-before",
        recovered: true,
      });
    } finally {
      db.close();
    }
  });
});
describe("capacity accounting", () => {
  const principal = {
    mode: "demo" as const,
    id: "synthetic",
    memoryConsent: false,
  };
  it.each(["chat", "speech", "transcribe", "memory"] as const)(
    "reserves %s with bounded configured budgets and releases once",
    async (service) => {
      mocks.env.CHAT_DAILY_LIMIT = "-1";
      mocks.env.SPEECH_DAILY_LIMIT = "12000";
      mocks.env.TRANSCRIBE_DAILY_LIMIT = "invalid";
      mocks.store.mockResolvedValue({ allowed: true });
      const release = await reserveCapacity(service, principal, 0.2);
      const payload = mocks.store.mock.calls[0]![0];
      expect(payload).toMatchObject({
        service,
        units: 1,
        personalMax: 40,
        concurrency: 1,
      });
      expect(payload.max).toBe(
        service === "chat" ? 1 : service === "speech" ? 10000 : 600,
      );
      await release();
      expect(mocks.store).toHaveBeenLastCalledWith({
        action: "inferenceRelease",
        attemptId: payload.attemptId,
      });
    },
  );
  it.each([
    { reason: "concurrency", retryAfter: 0, code: "INFERENCE_BUSY" },
    { reason: "concurrency", code: "INFERENCE_BUSY" },
    { reason: "daily", code: "DAILY_CAPACITY_EXHAUSTED" },
    { reason: "daily", retryAfter: 12, code: "DAILY_CAPACITY_EXHAUSTED" },
  ])("reports $code with a usable retry delay", async (result) => {
    mocks.store.mockResolvedValue({ allowed: false, ...result });
    await expect(reserveCapacity("chat", principal, 4)).rejects.toMatchObject({
      status: 429,
      code: result.code,
      retryAfterSeconds: expect.any(Number),
    });
  });
  it("charges account work, swallows release failure, but retains a lease when upstream cancellation is uncertain", async () => {
    mocks.store
      .mockResolvedValueOnce({ allowed: true })
      .mockRejectedValueOnce(Error("release unavailable"));
    expect(
      await withInferenceCapacity(
        "chat",
        { ...principal, mode: "account" },
        4,
        async () => "result",
      ),
    ).toBe("result");
    expect(mocks.store.mock.calls[0]![0]).toMatchObject({
      personalMax: 180,
      concurrency: 2,
    });
    for (const error of [
      Error("failure"),
      "unknown",
      new DOMException("canceled", "AbortError"),
      new DOMException("late", "TimeoutError"),
    ]) {
      mocks.store.mockReset().mockResolvedValue({ allowed: true });
      await expect(
        withInferenceCapacity("speech", principal, 3, async () => {
          throw error;
        }),
      ).rejects.toBe(error);
      expect(mocks.store).toHaveBeenCalledTimes(
        error instanceof DOMException ? 1 : 2,
      );
    }
  });
});
describe("memory score and payload compatibility", () => {
  it("normalizes provider score forms and ignores unusable records", () => {
    for (const value of [null, 1, "bad", {}])
      expect(parseRerankerScores(value).size).toBe(0);
    expect([
      ...parseRerankerScores([
        -0.2,
        1.2,
        null,
        "bad",
        { index: 9, relevance_score: 0.8 },
        { score: 0 },
        { relevance_score: -3 },
        { id: 8 },
      ]),
    ]).toEqual([
      [0, 0],
      [1, 1],
      [9, 0.8],
      [5, 0],
      [6, 1 / (1 + Math.exp(3))],
      [8, 0],
    ]);
    expect(
      parseRerankerScores({ response: [{ id: 1, score: 3 }] }).get(1),
    ).toBeGreaterThan(0.9);
  });
  it("keeps pinned memories, ranks lexical matches and tolerates invalid or future dates", () => {
    const state = freshDemo(),
      base = {
        id: "m",
        userId: "u",
        companionId: "c",
        type: "semantic" as const,
        content: "tea",
        normalizedContent: "tea",
        importance: 0.5,
        confidence: 0.8,
        sourceMessageIds: [],
        createdAt: "invalid",
        updatedAt: "invalid",
        retrievalCount: 0,
        status: "active" as const,
        pinned: false,
      };
    state.memories = [
      base,
      {
        ...base,
        id: "p",
        pinned: true,
        content: "art",
        updatedAt: "2099-01-01",
      },
    ];
    expect(
      rankSemanticMemories("tea", state.memories).some(
        (x) => x.reason === "hybrid",
      ),
    ).toBe(true);
    expect(rankSemanticMemories("!!!", state.memories, undefined, 0)).toEqual([
      expect.objectContaining({ id: "p", reason: "pinned" }),
    ]);
    expect(
      rankSemanticMemories("tea", [base], new Map([[0, 2]]))[0]?.score,
    ).toBe(1);
  });
  it("validates every optional preference and numeric input before inference", () => {
    const payload = {
      user: { name: "QA" },
      companion: { name: "Mira", backstory: "", personality: { warmth: 0.7 } },
      messages: [{ role: "user", content: "Hello" }],
      relationshipMode: "mentor",
      delivery: "video",
      responsePreferences: {
        responseLength: "deep",
        adviceStyle: "direct",
        questionFrequency: "rare",
        listeningFirst: true,
      },
    };
    expect(parseChatPayload(payload).responsePreferences?.listeningFirst).toBe(
      true,
    );
    expect(
      parseChatPayload({ ...payload, responsePreferences: {} })
        .responsePreferences,
    ).toEqual({});
    for (const listeningFirst of [0, "yes", null])
      expect(() =>
        parseChatPayload({
          ...payload,
          responsePreferences: { listeningFirst },
        }),
      ).toThrow();
    for (const warmth of [null, "1", NaN, Infinity, -0.1, 1.1])
      expect(() =>
        parseChatPayload({
          ...payload,
          companion: { name: "Mira", personality: { warmth } },
        }),
      ).toThrow();
    for (const messages of [
      null,
      [],
      [{ role: "assistant", content: "hi" }],
      Array(49).fill({ role: "user", content: "hi" }),
    ])
      expect(() => parseChatPayload({ ...payload, messages })).toThrow();
  });
  it("rejects malformed memory metadata and uses server-owned account contents", () => {
    const principal = { mode: "demo" as const, id: "u", memoryConsent: true },
      base = { id: "m", content: "Likes tea" };
    expect(parseMemoryPayload({ query: "tea" }, principal).memories).toEqual(
      [],
    );
    for (const patch of [
      { pinned: "yes" },
      { updatedAt: "invalid" },
      { importance: -1 },
      { importance: Infinity },
      { retrievalCount: 0.3 },
      { retrievalCount: 1000001 },
    ])
      expect(() =>
        parseMemoryPayload(
          { query: "tea", memories: [{ ...base, ...patch }] },
          principal,
        ),
      ).toThrow();
    for (const limit of [0, 9, 1.2, "1", NaN])
      expect(() =>
        parseMemoryPayload({ query: "tea", limit }, principal),
      ).toThrow();
    const state = freshDemo();
    state.user.id = "u";
    const saved = parseMemoryPayload(
      {
        query: "tea",
        memories: [
          {
            ...base,
            pinned: true,
            importance: 1,
            retrievalCount: 2,
            updatedAt: "2026-09-26",
          },
        ],
        limit: 1,
      },
      principal,
    ).memories[0]!;
    state.memories = [saved];
    expect(
      parseMemoryPayload(
        { query: "tea", memories: [{ ...base, content: "injected" }] },
        { ...principal, mode: "account", state },
      ).memories[0]?.content,
    ).toBe("Likes tea");
    expect(() =>
      parseMemoryPayload(
        { query: "tea", memories: [{ id: "other", content: "no" }] },
        { ...principal, mode: "account", state },
      ),
    ).toThrow();
  });
  it("deduplicates vocabulary, accepts valid recording hints and rejects malformed words", () => {
    const audioBase64 = Buffer.alloc(64).toString("base64");
    expect(
      parseTranscriptionPayload({
        audioBase64,
        contentType: "audio/ogg; codecs=opus",
        durationMs: 120,
        vocabulary: ["Pune", "Pune"],
      }),
    ).toMatchObject({ durationMs: 120, vocabulary: ["Pune"] });
    for (const term of ["<script>", "?tea", ""])
      expect(() =>
        parseTranscriptionPayload({ audioBase64, vocabulary: [term] }),
      ).toThrow();
    expect(() =>
      parseTranscriptionPayload({ audioBase64, durationMs: 0 }),
    ).toThrow();
  });
  it("alerts only on significant failure or companion latency and refuses Node imports in browsers", () => {
    expect(
      operationalAlerts([
        {
          name: "api:companion-chat",
          total: 10,
          failures: 0,
          averageLatencyMs: 7000,
          day: "today",
        },
        { name: "signup", total: 10, failures: 1, averageLatencyMs: 10 },
        { name: "signup", total: 2, failures: 2 },
        { name: "signup", total: 10, failures: 0, averageLatencyMs: 7000 },
      ]),
    ).toHaveLength(2);
    expect(() => createRequire()).toThrow("unavailable");
  });
});

describe("speech text and companion response boundaries", () => {
  it("preserves Hindi numerals/visarga and bounds mouth poses and long unbroken speech", async () => {
    const { romanizeHindiForEnglishTts, mouthPoseForText, speechChunks } =
      await import("./speech");
    expect(romanizeHindiForEnglishTts("अः ०१२३४५६७८९")).toBe("ah 0123456789");
    expect(mouthPoseForText("   ", 0)).toBe(0);
    expect(mouthPoseForText("bcdf", 0)).toBe(2);
    expect(mouthPoseForText("bcdf", 1)).toBe(1);
    expect(speechChunks("x".repeat(1200))).toEqual([
      "x".repeat(500),
      "x".repeat(500),
      "x".repeat(200),
    ]);
  });
  it("handles absent reply streams, anonymous errors and safe replies without coercing missing text", async () => {
    const { requestFreeCompanionReply } = await import("./free-chat");
    const input = {
      messages: [],
      companion: { name: "Mira" },
      user: { name: "QA" },
    };
    const http = vi.fn();
    vi.stubGlobal("fetch", http);
    try {
      for (const response of [
        new Response("offline", { status: 503 }),
        Response.json({}, { status: 429, headers: { "x-request-id": "r" } }),
      ]) {
        http.mockResolvedValueOnce(response);
        await expect(requestFreeCompanionReply(input)).rejects.toMatchObject({
          code: "SERVICE_UNAVAILABLE",
        });
      }
      http.mockResolvedValueOnce(
        new Response(null, {
          headers: { "content-type": "application/x-ndjson" },
        }),
      );
      await expect(requestFreeCompanionReply(input)).rejects.toMatchObject({
        code: "INCOMPLETE_STREAM",
      });
      http.mockResolvedValueOnce(Response.json({}));
      await expect(requestFreeCompanionReply(input)).rejects.toMatchObject({
        code: "INVALID_REPLY",
      });
      http.mockResolvedValueOnce(
        Response.json({ reply: "I'm here.", model: "safety" }),
      );
      expect(
        await requestFreeCompanionReply(input, new AbortController().signal),
      ).toBe("I'm here.");
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("keeps safe refusals while replacing harmful output in each supported language", async () => {
    const {
      assessCompanionSafety,
      unsafeCompanionOutput,
      safeOutputReplacement,
    } = await import("./companion-safety");
    expect(assessCompanionSafety([])).toBeNull();
    expect(
      assessCompanionSafety([{ role: "user", content: "revenge porn" }])
        ?.category,
    ).toBe("exploitation");
    expect(unsafeCompanionOutput("revenge porn")).toBe("exploitation");
    expect(unsafeCompanionOutput("I will kill him")).toBe("violence");
    expect(
      unsafeCompanionOutput("I cannot support revenge porn"),
    ).toBeUndefined();
    for (const lang of ["hi", "hinglish", "en"] as const) {
      expect(safeOutputReplacement("identity", lang)).toContain("AI");
      expect(safeOutputReplacement("exploitation", lang)).toBeTruthy();
    }
  });
});

describe("bounded data and provider stream inputs", () => {
  it("rejects oversized profiles and malformed legacy envelopes while normalizing old voices", async () => {
    const { validateAccountState, decodeAccountState, ownAccountState } =
      await import("./account-state-schema");
    for (const value of [
      null,
      [],
      {},
      { user: {}, companion: {}, messages: null },
    ])
      expect(() => decodeAccountState(JSON.stringify(value))).toThrow();
    expect(() => validateAccountState(null)).toThrow("profile");
    const state = freshDemo();
    expect(() => validateAccountState(state, 1)).toThrow("storage limit");
    state.companion.voiceId = "mira-natural-01";
    expect(ownAccountState(state, "owner").companion.voiceId).toBe("Priya");
    state.journalEntries = Array.from({ length: 80 }, (_, i) => ({
      id: `j${i}`,
      userId: state.user.id,
      title: "Entry",
      content: "x".repeat(12000),
      mood: "calm",
      tags: [],
      reflected: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    expect(() => validateAccountState(state)).toThrow("850 KB");
  });
  it("refuses empty inference replies and missing recovery bodies", async () => {
    const { resolveConversationTurn } = await import("./conversation-turn"),
      { boundedRecoveryJson } = await import("./recovery-io");
    const save = vi.fn();
    await expect(
      resolveConversationTurn(
        { turnId: "t", signal: new AbortController().signal },
        async () => " ",
        save,
      ),
    ).rejects.toThrow("no reply");
    expect(save).not.toHaveBeenCalled();
    await expect(boundedRecoveryJson(new Response(null))).rejects.toThrow(
      "RECOVERY_BODY_INVALID",
    );
  });
  it("keeps empty conversation helpers harmless and fixes lower-case travel ownership", async () => {
    const { groundReplyPerspective } = await import("./reply-perspective"),
      {
        conversationFocus,
        isPastExperienceStatement,
        isStandalonePersonalHabit,
        replyGroundingIssue,
      } = await import("./conversation-focus");
    expect(groundReplyPerspective({ messages: [] }, "hello")).toBe("hello");
    expect(isPastExperienceStatement({ messages: [] })).toBeFalsy();
    expect(isStandalonePersonalHabit({ messages: [] })).toBe(false);
    expect(conversationFocus({ messages: [] }, "en")).toContain("Perspective");
    const messages = [
      { role: "user" as const, content: "I am leaving for a trip tomorrow." },
      { role: "user" as const, content: "Summarize it." },
    ];
    expect(
      groundReplyPerspective(
        { messages },
        "we are leaving. we will travel with my sister on our trip.",
      ),
    ).toBe("you are leaving. you will travel with your sister on your trip.");
    expect(
      conversationFocus(
        { messages: [{ role: "user", content: "That happened to me." }] },
        "en",
      ),
    ).toContain("ALREADY");
    expect(
      replyGroundingIssue(
        { messages: [{ role: "user", content: "I often paint." }] },
        "123",
      ),
    ).toBeNull();
  });
  it("bounds speech prompts, accepts MP3 frame headers and handles OGG/WAV input metadata", async () => {
    const { fitInworldSpeechPrompt, decodeInworldAudio } = await import(
        "./inworld-speech"
      ),
      { createInworldTranscriptionRequest, readInworldTranscript } =
        await import("./inworld-transcription");
    expect(fitInworldSpeechPrompt("x".repeat(600))).toHaveLength(500);
    expect(
      fitInworldSpeechPrompt("word ".repeat(200)).length,
    ).toBeLessThanOrEqual(500);
    expect(
      decodeInworldAudio(Buffer.from([255, 251, 1]).toString("base64")),
    ).toEqual(Uint8Array.of(255, 251, 1));
    for (const type of ["audio/ogg", "audio/wav"])
      expect(
        JSON.parse(
          String(
            createInworldTranscriptionRequest("audio", type, "synthetic").body,
          ),
        ).transcribeConfig.audioEncoding,
      ).toBe(type === "audio/ogg" ? "OGG_OPUS" : "AUTO_DETECT");
    for (const result of [null, 3, { transcription: { transcript: 5 } }])
      expect(readInworldTranscript(result)).toBe("");
  });
  it("rejects oversized NDJSON and invalid or overlong deltas, ignoring blank lines", async () => {
    const { readCompanionReplyStream } = await import("./chat-stream-protocol");
    const read = (text: string) =>
      readCompanionReplyStream(
        new Response(text).body!,
        new AbortController().signal,
      );
    for (const text of [
      "x".repeat(20001),
      JSON.stringify({ type: "delta", text: "x".repeat(4001) }) + "\n",
      '{"type":"unknown"}\n',
    ])
      await expect(read(text)).rejects.toMatchObject({
        code: "INCOMPLETE_STREAM",
      });
    expect(
      await read(
        "\n  \n" +
          JSON.stringify({ type: "done", reply: "Hello", model: "test" }) +
          "\n",
      ),
    ).toEqual({ reply: "Hello", model: "test" });
  });
  it("rejects invalid SSE text and unbounded replies while tolerating empty metadata frames", async () => {
    const { readChatStream } = await import("./chat-stream");
    const read = (text: string) =>
      readChatStream(
        new Response(text).body!,
        new AbortController().signal,
        false,
      );
    await expect(read('data: {"response":7}\n\n')).rejects.toThrow(
      "Invalid inference text",
    );
    await expect(
      read(`data: ${JSON.stringify({ response: "x".repeat(4001) })}\n\n`),
    ).rejects.toThrow("reply exceeded");
    expect(
      await read('data: \n\ndata: {"response":"Hello"}\n\ndata: [DONE]\n'),
    ).toBe("Hello");
  });
  it("limits encrypted backup payloads and rejects wrong sealed input types", async () => {
    const { sealBackup, openBackup } = await import("./backup-crypto");
    const key = {
      keyId: "synthetic",
      material: Buffer.alloc(32).toString("base64"),
    };
    await expect(sealBackup("x".repeat(1800001), "chunk", key)).rejects.toThrow(
      "BACKUP_CHUNK_LIMIT",
    );
    for (const value of [null, [], 1])
      await expect(openBackup(value, "chunk", key)).rejects.toThrow(
        "BACKUP_INVALID",
      );
  });
});

describe("selection, migration and stream completion limits", () => {
  it("keeps pinned recall order and requires useful lexical matches", async () => {
    const { relevantMemoryContents } = await import("./memory-relevance");
    const base = {
        id: "m",
        userId: "u",
        companionId: "c",
        type: "semantic" as const,
        content: "watercolor painting",
        normalizedContent: "watercolor painting",
        importance: 0.5,
        confidence: 0.9,
        sourceMessageIds: [],
        createdAt: "2026-09-26",
        updatedAt: "2026-09-26",
        retrievalCount: 0,
        status: "active" as const,
        pinned: false,
      },
      pinned = { ...base, id: "p", pinned: true, content: "morning jogging" };
    const messages = (content: string) => [
      {
        id: "q",
        conversationId: "c",
        role: "user" as const,
        content,
        createdAt: "2026-09-26",
      },
    ];
    expect(
      relevantMemoryContents(
        [base, pinned],
        messages("What do you remember about me?"),
      ),
    ).toEqual([pinned.content, base.content]);
    expect(
      relevantMemoryContents([pinned, base], messages("watercolor painting")),
    ).toEqual([base.content]);
    expect(relevantMemoryContents([base], messages("!!!"))).toEqual([]);
    expect(
      relevantMemoryContents(
        [{ ...base, content: "friend" }],
        messages("friend"),
      ),
    ).toEqual([]);
  });
  it("uses per-service budgets and alerts for call latency independently of errors", async () => {
    const { monitorAlerts } = await import("./operational-monitor"),
      { launchReadiness } = await import("./launch-readiness");
    expect(
      monitorAlerts(
        [
          {
            name: "product:call_roundtrip_ms",
            total: 20,
            failures: 0,
            p95UpperBoundMs: 8000,
          },
          { name: "other", total: 20, failures: 0, p95UpperBoundMs: 8000 },
        ],
        [
          { key: "attempts:chat", count: 80 },
          { key: "attempts:speech", count: 80 },
          { key: "attempts:transcribe", count: 480 },
        ],
        {
          CHAT_DAILY_LIMIT: "100",
          SPEECH_DAILY_LIMIT: "100",
          TRANSCRIBE_DAILY_LIMIT: "invalid",
        },
      ),
    ).toHaveLength(4);
    expect(
      launchReadiness({
        DODO_PAYMENTS_ENVIRONMENT: "live_mode",
        MIRA_BACKUP_KEY: Buffer.alloc(32).toString("base64"),
        MIRA_BACKUP_KEY_ID: "valid",
      }),
    ).toBeTruthy();
  });
  it("refuses malformed browser demo envelopes and restores a missing optional collection", async () => {
    const { restoreDemo, serializeDemo } = await import("./demo-storage"),
      { environmentForItem } = await import("./product-rules");
    expect(restoreDemo(null).state.messages).toEqual([]);
    for (const value of [null, [], 2])
      expect(() => restoreDemo(JSON.stringify(value))).toThrow();
    const state = freshDemo();
    const saved = JSON.parse(serializeDemo(state));
    saved.state.nudges = "broken";
    expect(() => restoreDemo(JSON.stringify(saved))).toThrow();
    const item = {
      ...state.storeItems[0]!,
      category: "Room" as const,
      id: "rainy-cafe",
      metadata: {},
    };
    expect(environmentForItem(item)).toBe("rainy-cafe");
  });
  it("caps incremental frames, suppresses empty deltas and refuses a changed final prefix", async () => {
    const { chatDeliveryStream } = await import("./chat-delivery-stream");
    mocks.store.mockResolvedValue({});
    const base = {
      requestId: "qa",
      startedAt: Date.now(),
      signal: new AbortController().signal,
      check: async () => {},
    };
    const response = chatDeliveryStream({
      ...base,
      work: async (emit) => {
        await emit("");
        for (let i = 1; i <= 10; i++) await emit("x".repeat(i));
        return { reply: "x".repeat(10), model: "synthetic" };
      },
    });
    const frames = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(frames.filter((x) => x.type === "delta")).toHaveLength(8);
    expect(frames.at(-1)).toMatchObject({
      type: "done",
      reply: "x".repeat(10),
    });
    for (const during of [true, false]) {
      const response = chatDeliveryStream({
        ...base,
        work: async (emit) => {
          await emit("original");
          if (during) await emit("changed");
          return { reply: "changed", model: "synthetic" };
        },
      });
      expect(await response.text()).toContain('"code":"STREAM_CHANGED"');
    }
  });
});
