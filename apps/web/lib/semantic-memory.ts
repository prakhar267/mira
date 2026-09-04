import type { MemoryRecord } from "@companion/shared";

export interface SemanticMemoryMatch {
  id: string;
  score: number;
  reason: "semantic" | "hybrid" | "pinned";
}

function words(value: string) {
  return new Set(value.toLocaleLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? []);
}

export function parseRerankerScores(result: unknown) {
  const record = result && typeof result === "object" ? result as Record<string, unknown> : {};
  const response = Array.isArray(record.response) ? record.response : Array.isArray(result) ? result : [];
  const scores = new Map<number, number>();
  response.forEach((item, position) => {
    if (typeof item === "number") {
      scores.set(position, Math.max(0, Math.min(1, item)));
      return;
    }
    if (!item || typeof item !== "object") return;
    const candidate = item as Record<string, unknown>;
    const index = typeof candidate.id === "number" ? candidate.id
      : typeof candidate.index === "number" ? candidate.index : position;
    const rawScore = typeof candidate.score === "number" ? candidate.score
      : typeof candidate.relevance_score === "number" ? candidate.relevance_score : 0;
    const score = rawScore >= 0 && rawScore <= 1 ? rawScore : 1 / (1 + Math.exp(-rawScore));
    scores.set(index, Math.max(0, Math.min(1, score)));
  });
  return scores;
}

export function rankSemanticMemories(
  query: string,
  memories: MemoryRecord[],
  semanticScores = new Map<number, number>(),
  limit = 8,
): SemanticMemoryMatch[] {
  const queryWords = words(query);
  const now = Date.now();
  return memories.map((memory, index) => {
    const memoryWords = words(memory.content);
    const overlap = [...queryWords].filter((word) => word.length > 2 && memoryWords.has(word)).length;
    const lexical = queryWords.size ? Math.min(1, overlap / Math.max(2, queryWords.size * .45)) : 0;
    const ageDays = Math.max(0, (now - (Date.parse(memory.updatedAt) || now)) / 86_400_000);
    const recency = Math.exp(-ageDays / 120);
    const semantic = semanticScores.get(index) ?? 0;
    const score = semantic * .66 + lexical * .16 + memory.importance * .08 + recency * .04 + (memory.pinned ? .18 : 0);
    return {
      id: memory.id,
      score: Math.min(1, score),
      reason: memory.pinned && semantic < .25 ? "pinned" as const : semantic > .2 ? "semantic" as const : "hybrid" as const,
    };
  }).filter((match) => match.score >= .12)
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, Math.min(12, limit)));
}
