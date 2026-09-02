import type { MemoryRecord, MemoryType, RelationshipMode } from "@companion/shared";

export interface MemoryRankingWeights {
  semantic: number;
  importance: number;
  recency: number;
  relationship: number;
  retrieval: number;
}

const defaultWeights: MemoryRankingWeights = {
  semantic: 0.42,
  importance: 0.22,
  recency: 0.16,
  relationship: 0.12,
  retrieval: 0.08,
};

export interface MemoryRankingInput {
  query: string;
  memories: MemoryRecord[];
  now: Date;
  relationshipMode: RelationshipMode;
  weights?: Partial<MemoryRankingWeights>;
}

export interface RankedMemory {
  memory: MemoryRecord;
  score: number;
  factors: {
    semantic: number;
    importance: number;
    recency: number;
    relationship: number;
    retrieval: number;
  };
}

function tokens(input: string): Set<string> {
  return new Set(input.toLowerCase().normalize("NFKC").split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 2));
}

function lexicalSimilarity(query: string, content: string): number {
  const left = tokens(query);
  const right = tokens(content);
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / Math.sqrt(left.size * right.size);
}

function recencyScore(updatedAt: string, now: Date): number {
  const ageDays = Math.max(0, (now.getTime() - new Date(updatedAt).getTime()) / 86_400_000);
  return Math.exp(-ageDays / 45);
}

function relationshipScore(type: MemoryType, mode: RelationshipMode): number {
  if (type === "relationship" || type === "shared") return 1;
  if (mode === "mentor" && type === "goal") return 0.95;
  if (mode === "friend" && (type === "episodic" || type === "preference")) return 0.85;
  return 0.55;
}

export function rankMemories(input: MemoryRankingInput): RankedMemory[] {
  const weights = { ...defaultWeights, ...input.weights };
  return input.memories
    .filter((memory) => memory.status === "active")
    .map((memory) => {
      const factors = {
        semantic: lexicalSimilarity(input.query, memory.content),
        importance: Math.max(0, Math.min(memory.importance, 1)),
        recency: recencyScore(memory.updatedAt, input.now),
        relationship: relationshipScore(memory.type, input.relationshipMode),
        retrieval: 1 / (1 + Math.log2(memory.retrievalCount + 1)),
      };
      const score =
        factors.semantic * weights.semantic +
        factors.importance * weights.importance +
        factors.recency * weights.recency +
        factors.relationship * weights.relationship +
        factors.retrieval * weights.retrieval +
        (memory.pinned ? 0.08 : 0);
      return { memory, score, factors };
    })
    .sort((left, right) => right.score - left.score);
}

export interface MemoryCandidate {
  type: MemoryType;
  content: string;
  normalizedContent: string;
  importance: number;
  confidence: number;
}

export function extractMemoryCandidates(message: string): MemoryCandidate[] {
  const compact = message.trim().replace(/\s+/g, " ");
  const candidates: MemoryCandidate[] = [];
  const explicit = compact.match(/^(?:please\s+remember|remember|i want you to remember)(?:\s+that)?\s+(.{3,220})/i);
  if (explicit?.[1]) {
    const detail = explicit[1].replace(/\s+/g, " ").trim();
    const content = detail
      .replace(/\bI am\b/gi, "User is")
      .replace(/\bI(?:'|’)m\b/gi, "User is")
      .replace(/\bI have\b/gi, "User has")
      .replace(/\bI do not\b/gi, "User does not")
      .replace(/\bI don(?:'|’)t\b/gi, "User doesn't")
      .replace(/\bI (miss|love|like|prefer|want|need|feel|think|know|remember|live|work|hope|plan|care)\b/gi, (_match, verb: string) => {
        const irregular: Record<string, string> = { have: "has" };
        const lower = verb.toLowerCase();
        const inflected = irregular[lower]
          ?? (/(?:s|x|z|ch|sh)$/.test(lower)
            ? `${lower}es`
            : /[^aeiou]y$/.test(lower)
              ? `${lower.slice(0, -1)}ies`
              : `${lower}s`);
        return `User ${inflected}`;
      })
      .replace(/\bmyself\b/gi, "User")
      .replace(/\bmine\b/gi, "User's")
      .replace(/\bmy\b/gi, "User's")
      .replace(/\bme\b/gi, "User")
      .replace(/\bI\b/g, "User");
    const type: MemoryType = /\b(?:friend|partner|wife|husband|mother|father|mom|mum|dad|brother|sister|dog|cat|pet)\b/i.test(detail)
      ? "relationship"
      : /\b(?:today|tomorrow|tonight|anniversary|birthday|interview|appointment|exam|meeting|trip|died|passed away)\b/i.test(detail)
        ? "episodic"
        : "semantic";
    return [{
      type,
      content,
      normalizedContent: `explicit:${detail.toLowerCase().replace(/[.!?]+$/, "")}`,
      importance: 0.9,
      confidence: 0.99,
    }];
  }

  const preference = compact.match(/\b(?:i (?:really )?(?:like|love|prefer)|my favorite)\s+(.{3,120})/i);
  if (preference?.[1]) {
    const preferenceValue = preference[1].replace(/[.!?]+$/, "");
    candidates.push({
      type: "preference",
      content: `User likes ${preferenceValue}.`,
      normalizedContent: preferenceValue.toLowerCase(),
      importance: 0.66,
      confidence: 0.82,
    });
  }

  const person = compact.match(/\bmy\s+(sister|brother|mother|father|friend|partner|wife|husband)\s+(?:is named|is|called)\s+([\p{L}][\p{L}'-]{1,40})/iu);
  if (person?.[1] && person[2]) {
    candidates.push({
      type: "relationship",
      content: `User's ${person[1].toLowerCase()} is named ${person[2]}.`,
      normalizedContent: `${person[1].toLowerCase()}:${person[2].toLowerCase()}`,
      importance: 0.82,
      confidence: 0.91,
    });
  }

  const future = compact.match(/\b(?:my|i have an?)\s+(interview|presentation|appointment|exam|meeting|trip)\s+(?:is\s+)?(?:on\s+)?(today|tomorrow|tonight|this\s+\w+|next\s+\w+|(?:mon|tues|wednes|thurs|fri|satur|sun)day)/i);
  if (future?.[1] && future[2]) {
    candidates.push({
      type: "episodic",
      content: `User has a ${future[1].toLowerCase()} ${future[2].toLowerCase()}.`,
      normalizedContent: `${future[1].toLowerCase()}:${future[2].toLowerCase()}`,
      importance: 0.9,
      confidence: 0.88,
    });
  }

  const goal = compact.match(/\b(?:i want to|my goal is to|i'm trying to)\s+(.{4,140})/i);
  if (goal?.[1]) {
    candidates.push({
      type: "goal",
      content: `User wants to ${goal[1].replace(/[.!?]+$/, "")}.`,
      normalizedContent: goal[1].toLowerCase().replace(/[.!?]+$/, ""),
      importance: 0.78,
      confidence: 0.8,
    });
  }

  return candidates;
}

export function applyContradictions(existing: MemoryRecord[], candidate: MemoryCandidate, now = new Date()): MemoryRecord[] {
  const next = existing.map((memory) => ({ ...memory }));
  const candidateSubject = candidate.normalizedContent.split(":", 1)[0] ?? "";
  for (const memory of next) {
    if (memory.status !== "active" || memory.type !== candidate.type) continue;
    const existingSubject = memory.normalizedContent.split(":", 1)[0] ?? "";
    const sameSubject = candidateSubject.length > 2 && existingSubject === candidateSubject;
    const exactDuplicate = memory.normalizedContent === candidate.normalizedContent;
    if (exactDuplicate) return next;
    if (sameSubject && (candidate.type === "relationship" || candidate.type === "semantic")) {
      memory.status = "superseded";
      memory.updatedAt = now.toISOString();
    }
  }
  return next;
}
