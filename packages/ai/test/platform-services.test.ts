import { describe, expect, it, vi } from "vitest";
import type { FutureEventRecord, MemoryRecord, NotificationSettings } from "@companion/shared";
import type { ChatMessage } from "@companion/shared";
import type { CompanionContext } from "../src";
import { CircuitBreaker, collectMockResponse, generateNudge, summarizeConversation, withProviderResilience } from "../src";

describe("companion platform services", () => {
  it("creates bounded conversation summaries", () => {
    const summary = summarizeConversation("conversation-1", [{ id: "m1", conversationId: "conversation-1", role: "user", content: "My interview is Friday", createdAt: new Date().toISOString() }]);
    expect(summary.content).toContain("interview");
    expect(summary.sourceMessageIds).toEqual(["m1"]);
  });

  it("plans healthy event follow-ups outside quiet hours", () => {
    const settings: NotificationSettings = { frequency: "normal", quietStart: "22:00", quietEnd: "08:00", timezone: "UTC", enabledTopics: ["future-events"] };
    const event: FutureEventRecord = { id: "e1", userId: "u1", companionId: "c1", description: "Your interview", eventDate: "2026-09-01T10:00:00.000Z", status: "confirmed", createdAt: "2026-08-30T10:00:00.000Z" };
    const nudge = generateNudge({ userId: "u1", userName: "Mira", event, memories: [] as MemoryRecord[], settings, now: new Date("2026-08-30T22:30:00.000Z") });
    expect(nudge?.content).toContain("interview");
    expect(new Date(nudge!.scheduledFor).getUTCHours()).toBe(8);
  });

  it("falls back after provider failure and opens a circuit", async () => {
    const fallback = vi.fn(() => "safe fallback");
    await expect(withProviderResilience(async () => { throw new Error("down"); }, { timeoutMs: 20, retries: 1, fallback })).resolves.toBe("safe fallback");
    const breaker = new CircuitBreaker(2, 100);
    breaker.failure(0);
    breaker.failure(1);
    expect(breaker.canRun(50)).toBe(false);
    expect(breaker.canRun(102)).toBe(true);
  });

  it("answers emotional language before matching incidental preference words", async () => {
    const messages: ChatMessage[] = [{ id: "m1", conversationId: "c1", role: "user", content: "I feel nervous about tomorrow. Talk to me like a real person, not a chatbot.", createdAt: "2026-08-31T18:00:00.000Z" }];
    const context: CompanionContext = {
      identity: { name: "Luma" },
      user: { name: "Prakhar" },
      relationship: { mode: "romantic" },
      memories: [{ id: "memory-interview", type: "episodic", content: "Prakhar has a Stripe interview tomorrow at 11:00." }],
      recentMessages: messages,
      currentState: { now: "2026-08-31T18:00:00.000Z", timezone: "Asia/Kolkata", mood: "cheerful" },
      safetyInstructions: [],
      responseStyle: [],
    };

    const reply = await collectMockResponse(messages, context);
    expect(reply).toContain("Stripe interview");
    expect(reply).not.toContain("?");
    expect(reply).not.toContain("keep that in mind");
  });
});
