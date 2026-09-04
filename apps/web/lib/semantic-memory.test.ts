import { describe, expect, it } from "vitest";
import type { MemoryRecord } from "@companion/shared";
import { parseRerankerScores, rankSemanticMemories } from "./semantic-memory";

const memory = (id: string, content: string, pinned = false): MemoryRecord => ({
  id, userId: "u", companionId: "c", type: "semantic", content,
  normalizedContent: content.toLowerCase(), importance: .7, confidence: .9,
  sourceMessageIds: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  retrievalCount: 0, status: "active", pinned,
});

describe("semantic memory", () => {
  it("parses Cloudflare reranker response indexes and scores", () => {
    expect([...parseRerankerScores({ response: [{ id: 2, score: .91 }, { id: 0, score: .42 }] })]).toEqual([[2, .91], [0, .42]]);
  });

  it("combines multilingual semantic relevance with user-pinned memory", () => {
    const memories = [memory("food", "Prakhar loves masala dosa"), memory("sister", "Prakhar's sister is named Riya", true)];
    const ranked = rankSemanticMemories("meri behen ka naam kya hai", memories, new Map([[0, .08], [1, .94]]));
    expect(ranked[0]?.id).toBe("sister");
    expect(ranked[0]?.reason).toBe("semantic");
  });
});
