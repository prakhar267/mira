import { parseRerankerScores, rankSemanticMemories } from "@/lib/semantic-memory";
import { assertEdgeSameOrigin, EdgeRequestError, edgeError, edgeJson, edgeRateLimited, readEdgeJson } from "@/lib/edge-security";
import { authorizeInference } from "@/lib/inference-policy";
import { parseMemoryPayload } from "@/lib/inference-payloads";
import { withInferenceCapacity } from "@/lib/capacity";
import { withProviderDeadline } from "@/lib/provider-resilience";
import { assessCompanionSafety } from "@/lib/companion-safety";
import { assertCurrentMemoryContext } from "@/lib/inference-context";

const MODEL = "@cf/baai/bge-reranker-base";

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const respond = (body: unknown, status = 200, details: Record<string, unknown> = {}) => edgeJson(requestId, "companion-memory", startedAt, body, status, details);
  try {
    assertEdgeSameOrigin(request);
    const principal = await authorizeInference(request, "memory");
    if (await edgeRateLimited(request, "companion-memory", 36)) return respond({ error: "Memory lookup is cooling down." }, 429, { limited: true });
    const { query, limit, memories: candidates } = parseMemoryPayload(await readEdgeJson(request, 180_000), principal);
    // Sensitive safety context is not sent to an optional reranker. It remains
    // available to the primary chat safety decision without becoming a memory.
    const memories = candidates.filter(memory => !assessCompanionSafety([{ role: "user", content: memory.content }]));
    if (assessCompanionSafety([{ role: "user", content: query }])) return respond({ matches: [], model: "safety" });
    if (!query || !memories.length) return respond({ matches: [], model: "none" });
    const { env } = await import(/* webpackIgnore: true */ "cloudflare:workers");
    const result = await withInferenceCapacity("memory", principal, Math.ceil((query.length + memories.reduce((sum, memory) => sum + memory.content.length, 0)) / 4), () => withProviderDeadline("cloudflare-memory", async () => {
      assertCurrentMemoryContext(await authorizeInference(request, "memory"), memories);
      request.signal.throwIfAborted();
      return env.AI.run(MODEL as never, {
      query,
      contexts: memories.map((memory) => ({ text: memory.content })),
      top_k: Math.min(memories.length, 16),
    } as never); }, 3000, request.signal));
    const currentPrincipal = await authorizeInference(request, "memory");
    assertCurrentMemoryContext(currentPrincipal, memories);
    request.signal.throwIfAborted();
    const matches = rankSemanticMemories(query, memories, parseRerankerScores(result), limit);
    return respond({ matches, model: MODEL }, 200, { model: MODEL, candidates: memories.length });
  } catch (cause) {
    console.error(JSON.stringify({ event: "provider_failure", requestId, route: "companion-memory" }));
    if (cause instanceof EdgeRequestError) return edgeError(requestId, "companion-memory", startedAt, cause);
    return respond({ error: "Memory retrieval is temporarily unavailable." }, 503, { model: MODEL });
  }
}
