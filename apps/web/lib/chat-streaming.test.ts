import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { Readable } from "node:stream";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), provider: vi.fn(), capacity: vi.fn(), store: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: { AI: { run: mocks.provider } } }));
vi.mock("./inference-policy", () => ({ authorizeInference: mocks.authorize }));
vi.mock("./cloud-store", () => ({ storeAction: mocks.store }));
vi.mock("./capacity", () => ({ withInferenceCapacity: mocks.capacity }));
// Circuit/deadline policy has its own tests. Keep failure cases independent so
// deliberately rejected drafts do not put a later fixture into cooldown.
vi.mock("./provider-resilience", () => ({ withProviderDeadline: (_provider: string, work: (signal: AbortSignal) => Promise<unknown>, _timeout: number, parent?: AbortSignal) => work(parent ?? new AbortController().signal) }));
import { POST } from "../app/api/companion-chat/route";
import { companionApi } from "./api-client";
import { CHAT_STREAM_TYPE, readCompanionReplyStream } from "./chat-stream-protocol";
import { ConversationTurns, resolveConversationTurn } from "./conversation-turn";
import { EdgeRequestError } from "./edge-security";
import { chatDeliveryStream } from "./chat-delivery-stream";
import { freshDemo } from "./demo-storage";

const input = { user: { name: "Synthetic Adult" }, companion: { name: "Mira" }, messages: [{ role: "user" as const, content: "Help me prepare for my interview tomorrow." }], delivery: "text" as const };
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; };
function source() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const canceled = vi.fn(), encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; }, cancel: canceled });
  return { stream, canceled, text(value: string) { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ response: value })}\n\n`)); }, done() { controller.enqueue(encoder.encode("data: [DONE]\n\n")); }, error() { controller.enqueue(encoder.encode('data: {"error":"synthetic provider failure"}\n\n')); } };
}
const req = (signal?: AbortSignal, payload: unknown = input) => new Request("https://mira.test/api/companion-chat", { method: "POST", headers: { "content-type": "application/json", accept: CHAT_STREAM_TYPE }, body: JSON.stringify(payload), ...(signal ? { signal } : {}) });
beforeEach(() => {
  vi.resetAllMocks(); mocks.store.mockResolvedValue({ limited: false });
  mocks.authorize.mockResolvedValue({ mode: "demo", id: "synthetic", memoryConsent: true });
  mocks.capacity.mockImplementation((_service, _principal, _units, work) => work());
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("active route, actual HTTP transport and application reply adapter", () => {
  it("delivers a checked displayed update before upstream completion and commits only the final reply", async () => {
    const upstream = source(), providerStarted = deferred(), firstDisplayed = deferred(), finish = deferred();
    mocks.provider.mockImplementation(async () => { providerStarted.resolve(); return upstream.stream; });
    const server = createServer(async (incoming, outgoing) => {
      const parts: Buffer[] = []; for await (const part of incoming) parts.push(Buffer.from(part));
      const abort = new AbortController(); outgoing.on("close", () => abort.abort());
      const response = await POST(new Request(`http://127.0.0.1${incoming.url}`, { method: "POST", headers: { "content-type": "application/json", accept: CHAT_STREAM_TYPE }, body: Buffer.concat(parts), signal: abort.signal }));
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      Readable.fromWeb(response.body as import("node:stream/web").ReadableStream).pipe(outgoing);
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("No test server address");
    const nativeFetch = globalThis.fetch;
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => nativeFetch(`http://127.0.0.1:${address.port}${url}`, init));
    const turns = new ConversationTurns(), context = turns.begin()!, commit = vi.fn();
    let displayed = "", complete = false;
    try {
      const reply = resolveConversationTurn(context, signal => companionApi.demoReply(input, signal, delta => { displayed += delta; firstDisplayed.resolve(); }), commit).finally(() => finish.resolve());
      await providerStarted.promise;
      upstream.text("Let's practice your introduction. Start with the role you want.");
      await firstDisplayed.promise;
      expect(displayed).toBe("Let's practice your introduction.");
      expect(complete).toBe(false); expect(commit).not.toHaveBeenCalled();
      expect(mocks.capacity).toHaveBeenCalledOnce();
      upstream.text(" Then connect one project to that role."); complete = true; upstream.done();
      await expect(reply).resolves.toBe("Let's practice your introduction. Start with the role you want. Then connect one project to that role.");
      expect(commit).toHaveBeenCalledOnce();
    } finally { turns.cancel(); await finish.promise; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});

describe("checked frame and terminal boundaries", () => {
  it("fails closed after a checked prefix if later output is unsafe, with no final commit", async () => {
    const upstream = source(), first = deferred(); mocks.provider.mockResolvedValue(upstream.stream);
    const response = await POST(req()), delta = vi.fn(() => first.resolve()), commit = vi.fn();
    const context = new ConversationTurns().begin()!;
    const result = resolveConversationTurn(context, async signal => (await readCompanionReplyStream(response.body!, signal, delta)).reply, commit);
    const rejected = expect(result).rejects.toMatchObject({ code: "UNSAFE_STREAM", status: 503 });
    upstream.text("Let's practice your introduction. Start with your current role."); await first.promise;
    upstream.text(" You should kill yourself."); await rejected;
    expect(delta).toHaveBeenCalledOnce(); expect(commit).not.toHaveBeenCalled(); expect(upstream.canceled).toHaveBeenCalled();
  });
  it("does not expose split unsafe phrases or hidden reasoning before safety checking", async () => {
    const upstream = source(); mocks.provider.mockResolvedValue(upstream.stream);
    const response = await POST(req()), delta = vi.fn();
    const result = readCompanionReplyStream(response.body!, new AbortController().signal, delta);
    const rejected = expect(result).rejects.toMatchObject({ code: "UNSAFE_STREAM" });
    upstream.text("You should kill "); upstream.text("yourself. This is my advice."); await rejected;
    expect(delta).not.toHaveBeenCalled();
  });
  it("uses category support for risky input without any provider capacity", async () => {
    const response = await POST(req(undefined, { ...input, messages: [{ role: "user", content: "मुझे जीना नहीं है" }] }));
    const result = await readCompanionReplyStream(response.body!, new AbortController().signal);
    expect(result.model).toBe("safety"); expect(result.reply).toContain("सहारा"); expect(mocks.provider).not.toHaveBeenCalled(); expect(mocks.capacity).not.toHaveBeenCalled();
  });
  it("reports a provider error after headers as a typed terminal failure", async () => {
    const upstream = source(); mocks.provider.mockResolvedValue(upstream.stream);
    const response = await POST(req()); expect(response.status).toBe(200);
    const rejected = expect(readCompanionReplyStream(response.body!, new AbortController().signal)).rejects.toMatchObject({ code: "STREAM_FAILED", status: 503 });
    upstream.error(); await rejected;
  });
  it("rechecks consent immediately before an application frame leaves its zero-buffer queue", async () => {
    const upstream = source(), ready = deferred();
    mocks.provider.mockImplementation(async () => { ready.resolve(); return upstream.stream; });
    const response = await POST(req()); await ready.promise;
    upstream.text("Let's practice your introduction. Start with your current role.");
    mocks.authorize.mockRejectedValue(new EdgeRequestError("Processing paused", 403, "CONSENT_REQUIRED"));
    const delta = vi.fn();
    await expect(readCompanionReplyStream(response.body!, new AbortController().signal, delta)).rejects.toMatchObject({ code: "CONSENT_REQUIRED", status: 403 });
    expect(delta).not.toHaveBeenCalled();
  });
  it("rechecks a pending done event after withdrawal", async () => {
    const response = await POST(req(undefined, { ...input, messages: [{ role: "user", content: "What is your name?" }] }));
    mocks.authorize.mockRejectedValue(new EdgeRequestError("Account deleted", 401, "SESSION_REQUIRED"));
    await expect(readCompanionReplyStream(response.body!, new AbortController().signal)).rejects.toMatchObject({ status: 401 });
  });
  for (const change of ["paused", "deleted", "corrected"] as const) it(`does not release a queued memory-derived prefix after memory ${change}`, async () => {
    const state = freshDemo(); state.user.id = "owner"; state.user.adultConfirmed = true;
    state.memories = [{ id: "owned", userId: "owner", companionId: "c", type: "semantic", content: "My plant is Cedar.", normalizedContent: "my plant is cedar.", importance: .5, confidence: .8, sourceMessageIds: [], createdAt: "2026-09-13", updatedAt: "2026-09-13", retrievalCount: 0, status: "active", pinned: false }];
    const principal = { mode: "account", id: "owner", memoryConsent: true, state };
    const upstream = source(), ready = deferred(); mocks.authorize.mockResolvedValue(principal);
    mocks.provider.mockImplementation(async () => { ready.resolve(); return upstream.stream; });
    const response = await POST(req()); await ready.promise;
    upstream.text("Your plant is Cedar. Let's use that as an example.");
    const changed = structuredClone(principal);
    if (change === "paused") changed.memoryConsent = false;
    if (change === "deleted") changed.state.memories = [];
    if (change === "corrected") changed.state.memories[0]!.content = "My plant is Maple.";
    mocks.authorize.mockResolvedValue(changed);
    const delta = vi.fn();
    await expect(readCompanionReplyStream(response.body!, new AbortController().signal, delta)).rejects.toMatchObject({ code: "CONTEXT_CHANGED", status: 409 });
    expect(delta).not.toHaveBeenCalled();
  });
  it("cannot emit a held prefix after the provider deadline expires behind backpressure", async () => {
    const provider = new AbortController();
    const response = chatDeliveryStream({ requestId: "slow-consumer", startedAt: Date.now(), signal: new AbortController().signal, check: async () => undefined, work: async emit => { await emit("A held sentence.", provider.signal); return { reply: "A held sentence. Another sentence.", model: "synthetic" }; } });
    // No body reader yet: provider completion must not prequeue this text.
    provider.abort(new DOMException("Synthetic deadline", "TimeoutError"));
    const delta = vi.fn();
    await expect(readCompanionReplyStream(response.body!, new AbortController().signal, delta)).rejects.toMatchObject({ code: "STREAM_FAILED" });
    expect(delta).not.toHaveBeenCalled();
  });
  for (const ending of ["done", "error"] as const) it(`bounds a never-reading client waiting for terminal ${ending}`, async () => {
    vi.useFakeTimers();
    const response = chatDeliveryStream({ requestId: "never-reading", startedAt: Date.now(), signal: new AbortController().signal, check: async () => undefined, work: async () => { if (ending === "error") throw new Error("Synthetic failure"); return { reply: "A completed reply.", model: "synthetic" }; } });
    await vi.advanceTimersByTimeAsync(15_001);
    await expect(readCompanionReplyStream(response.body!, new AbortController().signal)).rejects.toMatchObject({ code: "INCOMPLETE_STREAM" });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels provider reading and refuses state commits after caller abort", async () => {
    const upstream = source(), first = deferred(), abort = new AbortController(); mocks.provider.mockResolvedValue(upstream.stream);
    const response = await POST(req(abort.signal));
    const result = readCompanionReplyStream(response.body!, abort.signal, () => first.resolve());
    const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
    upstream.text("Let's practice your introduction. Start with your current role."); await first.promise; abort.abort(); await rejected;
    expect(upstream.canceled).toHaveBeenCalled();
  });
  it("preserves post-header quota status and real retry metadata", async () => {
    mocks.capacity.mockRejectedValue(new EdgeRequestError("Tomorrow's capacity", 429, "DAILY_CAPACITY_EXHAUSTED", 3600));
    const response = await POST(req());
    await expect(readCompanionReplyStream(response.body!, new AbortController().signal)).rejects.toMatchObject({ status: 429, code: "DAILY_CAPACITY_EXHAUSTED", retryAfterSeconds: 3600 });
    expect(mocks.provider).not.toHaveBeenCalled();
  });
});
