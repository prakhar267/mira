import { afterEach, describe, expect, it, vi } from "vitest";
import { companionApi } from "./api-client";
import { CallSession, type CallAdapters } from "./call-session";
import { ConversationTurns, appendUniqueMessages, resolveConversationTurn } from "./conversation-turn";
import { speechChunks } from "./speech";
import type { CallListeningOptions } from "./call-listening";
import type { ChatMessage } from "@companion/shared";

afterEach(() => vi.unstubAllGlobals());
const input = { messages: [{ role: "user" as const, content: "My meeting is Sunday morning." }], companion: { name: "Mira" }, user: { name: "Test adult" }, delivery: "voice" as const };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe.each(["voice", "video"] as const)("%s with real HTTP reply adapter", delivery => {
  it("keeps outage as failure, retries the same turn, commits once", async () => {
    const http = vi.fn().mockResolvedValueOnce(Response.json({ error: "Quota reached. Retry tomorrow.", code: "DAILY_LIMIT", requestId: "synthetic" }, { status: 429 })).mockResolvedValueOnce(Response.json({ reply: "Sunday morning. Got it, I will keep that in mind.", model: "test" }));
    vi.stubGlobal("fetch", http);
    const transcript: ChatMessage[] = [];
    let listen!: CallListeningOptions;
    const contexts: string[] = [];
    const speak = vi.fn(() => ({ cancel: vi.fn() }));
    const adapters: CallAdapters = {
      listen: async options => { listen = options; return { cancel() {} }; }, speak, update() {},
      respond: (text, context) => {
        contexts.push(context.turnId);
        const user: ChatMessage = { id: context.turnId, conversationId: "synthetic", role: "user", content: text, createdAt: new Date().toISOString(), status: "sent" };
        transcript.splice(0, transcript.length, ...appendUniqueMessages(transcript, [user]));
        return resolveConversationTurn(context, signal => companionApi.demoReply({ ...input, delivery }, signal), reply => {
          transcript.push({ ...user, id: `${user.id}:reply`, role: "assistant", content: reply });
        });
      },
    };
    const call = new CallSession(adapters, "Hi");
    call.listen(); await tick(); listen.onTranscript(input.messages[0]!.content); await tick();
    expect(call.state).toMatchObject({ phase: "error", error: "Quota reached. Retry tomorrow." });
    expect(transcript).toHaveLength(1); expect(speak).not.toHaveBeenCalled();
    call.retry(); await tick();
    expect(contexts[0]).toBe(contexts[1]); expect(transcript).toHaveLength(2); expect(speak).toHaveBeenCalledOnce();
    call.close();
  });
  it("fences ignored HTTP aborts after hang-up including state commits", async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(done => { resolve = done; })));
    let listen!: CallListeningOptions;
    const commit = vi.fn(), speak = vi.fn(() => ({ cancel() {} }));
    const call = new CallSession({ listen: async options => { listen = options; return { cancel() {} }; }, speak, update() {}, respond: (_text, context) => resolveConversationTurn(context, signal => companionApi.demoReply({ ...input, delivery }, signal), commit) }, "Hi");
    call.listen(); await tick(); listen.onTranscript("Sunday morning"); call.close();
    resolve(Response.json({ reply: "Sunday morning. That sounds like the right time.", model: "test" })); await tick();
    expect(commit).not.toHaveBeenCalled(); expect(speak).not.toHaveBeenCalled();
  });
});

it("rapid text/media begins cannot overlap and stale contexts cannot commit", async () => {
  const turns = new ConversationTurns();
  const first = turns.begin()!;
  expect(turns.begin()).toBeNull(); turns.cancel();
  const second = turns.begin()!; turns.finish(first); expect(turns.busy).toBe(true);
  await expect(resolveConversationTurn(first, async () => "late", vi.fn())).rejects.toMatchObject({ name: "AbortError" });
  turns.finish(second); expect(turns.busy).toBe(false);
});

it("long multilingual speech is segmented without truncating the text", () => {
  const text = ("Sunday ko meeting hai. फिर हम बात करेंगे। That sounds good. ").repeat(30).trim();
  const chunks = speechChunks(text);
  expect(chunks.every(chunk => chunk.length <= 500)).toBe(true);
  expect(chunks.join(" ")).toBe(text);
});
