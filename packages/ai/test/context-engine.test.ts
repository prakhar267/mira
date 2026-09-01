import { describe, expect, it } from "vitest";
import type { ChatMessage, CompanionProfile, MemoryRecord, UserProfile } from "@companion/shared";
import { applyContradictions, buildCompanionContext, extractMemoryCandidates, rankMemories } from "../src";

const now = new Date("2026-08-30T12:00:00.000Z");

function memory(overrides: Partial<MemoryRecord>): MemoryRecord {
  return {
    id: crypto.randomUUID(),
    userId: "user-1",
    companionId: "companion-1",
    type: "preference",
    content: "User likes Formula 1.",
    normalizedContent: "formula 1",
    importance: 0.7,
    confidence: 0.9,
    sourceMessageIds: ["message-1"],
    createdAt: "2026-08-20T12:00:00.000Z",
    updatedAt: "2026-08-20T12:00:00.000Z",
    retrievalCount: 0,
    status: "active",
    pinned: false,
    ...overrides,
  };
}

describe("memory pipeline", () => {
  it("extracts preference, relationship, future-event, and goal candidates", () => {
    expect(extractMemoryCandidates("I really love Formula 1")[0]?.type).toBe("preference");
    expect(extractMemoryCandidates("My sister is named Sarah")[0]?.type).toBe("relationship");
    expect(extractMemoryCandidates("My interview is tomorrow")[0]?.type).toBe("episodic");
    expect(extractMemoryCandidates("I want to launch a startup")[0]?.type).toBe("goal");
  });

  it("ranks relevant and pinned memories ahead of unrelated items", () => {
    const relevant = memory({ id: "relevant", content: "User's interview is tomorrow.", normalizedContent: "interview:tomorrow", type: "episodic" });
    const pinned = memory({ id: "pinned", content: "User loves hiking.", normalizedContent: "hiking", pinned: true });
    const unrelated = memory({ id: "unrelated", content: "User drinks coffee.", normalizedContent: "coffee", importance: 0.2 });
    const result = rankMemories({ query: "I am nervous about my interview", memories: [unrelated, pinned, relevant], now, relationshipMode: "friend" });
    expect(result[0]?.memory.id).toBe("relevant");
    expect(result.findIndex((item) => item.memory.id === "pinned")).toBeLessThan(result.findIndex((item) => item.memory.id === "unrelated"));
  });

  it("supersedes a conflicting relationship fact", () => {
    const existing = memory({ type: "relationship", normalizedContent: "sister:sarah", content: "User's sister is named Sarah." });
    const candidate = extractMemoryCandidates("My sister is named Priya")[0];
    expect(candidate).toBeDefined();
    const updated = applyContradictions([existing], candidate!, now);
    expect(updated[0]?.status).toBe("superseded");
  });
});

describe("buildCompanionContext", () => {
  it("enforces a bounded memory set and stable safety instructions", () => {
    const user: UserProfile = { id: "user-1", name: "Mira", birthday: "1998-04-02", pronouns: "she/her", interests: ["music"], timezone: "Asia/Kolkata", adultConfirmed: true };
    const companion: CompanionProfile = {
      id: "companion-1",
      name: "Noor",
      pronouns: "she/her",
      presentation: "warm",
      voiceId: "noor-warm",
      relationshipMode: "friend",
      mood: "calm",
      createdAt: "2026-08-01T00:00:00.000Z",
      personality: { warmth: 0.85, humor: 0.5, curiosity: 0.8, assertiveness: 0.45, optimism: 0.7, energy: 0.55, verbosity: 0.45, playfulness: 0.6, empathy: 0.85 },
    };
    const messages: ChatMessage[] = [{ id: "m1", conversationId: "c1", role: "user", content: "How should I prepare for my interview?", createdAt: now.toISOString() }];
    const context = buildCompanionContext({ user, companion, relationship: { mode: "friend", startedAt: companion.createdAt, interactionCount: 4, sharedExperiences: [] }, memories: [memory({ content: "User has an interview tomorrow.", type: "episodic" })], messages, timezone: user.timezone, now, tokenBudget: 300 });
    expect(context.memories).toHaveLength(1);
    expect(context.safetyInstructions.some((instruction) => instruction.includes("dependency"))).toBe(true);
  });
});
