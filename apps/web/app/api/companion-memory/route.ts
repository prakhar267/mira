import type { MemoryRecord } from "@companion/shared";
import { parseRerankerScores, rankSemanticMemories } from "@/lib/semantic-memory";
import { assertEdgeSameOrigin, EdgeRequestError, edgeError, edgeJson, edgeRateLimited, readEdgeJson } from "@/lib/edge-security";

const MODEL = "@cf/baai/bge-reranker-base";

function parseMemory(value: unknown): MemoryRecord | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || typeof item.content !== "string") return null;
  const now = new Date().toISOString();
  const content = item.content.trim().slice(0, 320);
  if (!content) return null;
  return {
    id: item.id.slice(0, 100), userId: "edge", companionId: "edge", type: "semantic",
    content, normalizedContent: content.toLowerCase(),
    importance: typeof item.importance === "number" ? Math.max(0, Math.min(1, item.importance)) : .5,
    confidence: .9, sourceMessageIds: [], createdAt: now,
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : now,
    retrievalCount: typeof item.retrievalCount === "number" ? item.retrievalCount : 0,
    status: "active", pinned: item.pinned === true,
  };
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const respond = (body: unknown, status = 200, details: Record<string, unknown> = {}) => edgeJson(requestId, "companion-memory", startedAt, body, status, details);
  try {
    assertEdgeSameOrigin(request);
    if (await edgeRateLimited(request, "companion-memory", 36)) return respond({ error: "Memory lookup is cooling down." }, 429, { limited: true });
    const body = await readEdgeJson(request, 40_000) as Record<string, unknown> | null;
    const query = typeof body?.query === "string" ? body.query.trim().slice(0, 600) : "";
    const memories = Array.isArray(body?.memories) ? body.memories.slice(0, 80).map(parseMemory).filter((memory): memory is MemoryRecord => Boolean(memory)) : [];
    const limit = typeof body?.limit === "number" ? body.limit : 8;
    if (!query || !memories.length) return respond({ matches: [], model: "none" });
    const { env } = await import(/* webpackIgnore: true */ "cloudflare:workers");
    const result = await env.AI.run(MODEL as never, {
      query,
      contexts: memories.map((memory) => ({ text: memory.content })),
      top_k: Math.min(memories.length, 16),
    } as never);
    return respond({ matches: rankSemanticMemories(query, memories, parseRerankerScores(result), limit), model: MODEL }, 200, { model: MODEL, candidates: memories.length });
  } catch (cause) {
    console.error("Semantic memory retrieval failed", cause instanceof Error ? cause.message : "unknown");
    if (cause instanceof EdgeRequestError) return edgeError(requestId, "companion-memory", startedAt, cause);
    return respond({ error: "Memory retrieval is temporarily unavailable." }, 503, { model: MODEL });
  }
}
