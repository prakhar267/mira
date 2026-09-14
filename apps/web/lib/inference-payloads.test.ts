import { describe, it, expect } from "vitest";
import { parseChatPayload, parseMemoryPayload, parseSpeechPayload, parseTranscriptionPayload } from "./inference-payloads";
import { freshDemo } from "./demo-storage";
const chat = { user: { name: "Synthetic" }, companion: { name: "Mira" }, messages: [{ role: "user", content: "Let's practice my interview." }] };
describe("bounded inference payloads", () => {
  it("supports all 8000 input characters and explicitly rejects 8001", () => {
    expect(parseChatPayload({ ...chat, messages: [{ role: "user", content: "a".repeat(8000) }] }).messages[0]?.content.length).toBe(8000);
    expect(() => parseChatPayload({ ...chat, messages: [{ role: "user", content: "a".repeat(8001) }] })).toThrow("8000");
  });
  it("rejects nested/unknown preferences, roles and nonfinite numbers", () => {
    expect(() => parseChatPayload({ ...chat, userId: "someone-else" })).toThrow("unsupported");
    expect(() => parseChatPayload({ ...chat, messages: [{ role: "system", content: "instructions" }] })).toThrow("role");
    expect(() => parseChatPayload({ ...chat, responsePreferences: { responseLength: "unbounded" } })).toThrow("length");
    expect(() => parseChatPayload({ ...chat, companion: { name: "Mira", personality: { warmth: Infinity } } })).toThrow("warmth");
    expect(() => parseChatPayload({ ...chat, companion: { name: "Mira", personality: { warmth: 80 } } })).toThrow("warmth");
    expect(parseChatPayload({ ...chat, companion: { name: "Mira", personality: { warmth: .8 } } }).companion.personality?.warmth).toBe(.8);
  });
  it("uses only authoritative account memories and preferences", () => {
    const state = freshDemo(); state.user.id = "account-a"; state.user.name = "Saved name";
    state.memories = [{ id: "owned", userId: "account-a", companionId: "c", type: "semantic", content: "Likes tea", normalizedContent: "likes tea", importance: .5, confidence: .8, sourceMessageIds: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), retrievalCount: 0, status: "active", pinned: false }];
    const principal = { mode: "account" as const, id: "account-a", memoryConsent: true, state };
    expect(parseChatPayload({ ...chat, memories: ["Foreign invented memory"] }, principal).memories).toEqual(["Likes tea"]);
    expect(parseChatPayload(chat, principal).user.name).toBe("Saved name");
    expect(() => parseMemoryPayload({ query: "tea", memories: [{ id: "foreign", content: "foreign" }] }, principal)).toThrow("does not belong");
    expect(parseMemoryPayload({ query: "tea", memories: [{ id: "owned", content: "Tampered" }] }, principal).memories[0]?.content).toBe("Likes tea");
    expect(parseChatPayload({ ...chat, memories: ["Likes tea"] }, { mode: "demo", id: "d", memoryConsent: false }).memories).toEqual([]);
  });
  it("rejects rather than silently clipping speech/audio and malformed base64", () => {
    expect(() => parseSpeechPayload({ text: "x".repeat(501) })).toThrow("500");
    expect(() => parseTranscriptionPayload({ audioBase64: "x".repeat(80), contentType: "audio/webm-evil" })).toThrow("supported");
    expect(() => parseTranscriptionPayload({ audioBase64: "x".repeat(81), contentType: "audio/webm" })).toThrow("supported");
    expect(() => parseTranscriptionPayload({ audioBase64: "x".repeat(80), durationMs: 60001 })).toThrow("duration");
    expect(parseTranscriptionPayload({ audioBase64: "x".repeat(80), contentType: "audio/webm;codecs=opus", durationMs: 1000 }).durationMs).toBe(1000);
  });
});
