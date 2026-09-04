import { buildCompanionSystemPrompt, buildMemoryRecallReply, isInvalidCompanionReply, isMemoryRecallRequest, requestsListeningOnly, sanitizeCompanionReply, type EdgeCompanionRequest } from "@/lib/companion-prompt";
import { assessSafety } from "@companion/ai";
import { assertEdgeSameOrigin, containsDisallowedAbuse, EdgeRequestError, edgeError, edgeJson, edgeRateLimited, readEdgeJson } from "@/lib/edge-security";

const MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";

function readModelText(result: unknown) {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return "";
  const record = result as Record<string, unknown>;
  if (typeof record.response === "string") return record.response;
  if (typeof record.output_text === "string") return record.output_text;
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const first = choices[0] as Record<string, unknown> | undefined;
  const message = first?.message as Record<string, unknown> | undefined;
  if (typeof message?.content === "string") return message.content;
  if (Array.isArray(message?.content)) {
    return message.content.flatMap((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).text === "string" ? [(item as Record<string, unknown>).text as string] : []).join("");
  }
  if (typeof first?.text === "string") return first.text;
  if (Array.isArray(record.output)) {
    return record.output.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const content = (item as Record<string, unknown>).content;
      return Array.isArray(content) ? content.flatMap((part) => part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string" ? [(part as Record<string, unknown>).text as string] : []) : [];
    }).join("");
  }
  return "";
}

function parseRequest(value: unknown): EdgeCompanionRequest | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.messages) || !raw.companion || !raw.user) return null;
  const messages = raw.messages.slice(-20).flatMap((message) => {
    if (!message || typeof message !== "object") return [];
    const item = message as Record<string, unknown>;
    if ((item.role !== "user" && item.role !== "assistant") || typeof item.content !== "string") return [];
    const content = item.content.trim().slice(0, 2_000);
    return content ? [{ role: item.role as "user" | "assistant", content }] : [];
  });
  if (!messages.length || messages.at(-1)?.role !== "user") return null;
  const companion = raw.companion as Record<string, unknown>;
  const user = raw.user as Record<string, unknown>;
  if (typeof companion.name !== "string" || typeof user.name !== "string") return null;
  return {
    messages,
    companion: {
      name: companion.name.slice(0, 40),
      ...(typeof companion.backstory === "string" ? { backstory: companion.backstory.slice(0, 500) } : {}),
      ...(companion.personality && typeof companion.personality === "object" ? { personality: companion.personality as Record<string, number> } : {}),
    },
    user: { name: user.name.slice(0, 40) },
    ...(typeof raw.relationshipMode === "string" ? { relationshipMode: raw.relationshipMode.slice(0, 24) } : {}),
    ...(Array.isArray(raw.memories) ? { memories: raw.memories.filter((memory): memory is string => typeof memory === "string").slice(0, 8).map((memory) => memory.slice(0, 220)) } : {}),
    ...(raw.responsePreferences && typeof raw.responsePreferences === "object" ? { responsePreferences: raw.responsePreferences as NonNullable<EdgeCompanionRequest["responsePreferences"]> } : {}),
    ...(raw.delivery === "voice" || raw.delivery === "video" || raw.delivery === "text" ? { delivery: raw.delivery } : {}),
  };
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const respond = (body: unknown, status = 200, details: Record<string, unknown> = {}) => edgeJson(requestId, "companion-chat", startedAt, body, status, details);
  try {
    assertEdgeSameOrigin(request);
    if (await edgeRateLimited(request, "companion-chat", 24)) return respond({ error: "Please give Mira a moment before sending more." }, 429, { limited: true });
    const input = parseRequest(await readEdgeJson(request, 55_000));
    if (!input) return respond({ error: "Invalid conversation request." }, 400);
    const latestUserMessage = input.messages.at(-1)?.content ?? "";
    const safety = assessSafety(latestUserMessage);
    if (safety.level !== "safe" && safety.response) return respond({ reply: safety.response, model: "safety" }, 200, { guard: safety.category });
    if (containsDisallowedAbuse(latestUserMessage)) return respond({ reply: "I can’t help sexualize minors, remove consent, or facilitate exploitation. We can keep this between consenting adults and talk about something safe instead.", model: "safety" }, 200, { guard: "exploitation" });
    if (isMemoryRecallRequest(latestUserMessage)) return respond({ reply: buildMemoryRecallReply(input), model: "memory" }, 200, { model: "memory" });
    const { env } = await import(/* webpackIgnore: true */ "cloudflare:workers");
    const suppressQuestions = input.responsePreferences?.questionFrequency === "rare" || requestsListeningOnly(latestUserMessage);
    const messages = [
      { role: "system", content: `/no_think\n${buildCompanionSystemPrompt(input)}` },
      ...input.messages,
    ];
    const run = async (promptMessages: typeof messages) => sanitizeCompanionReply(readModelText(await env.AI.run(MODEL as never, {
        messages: promptMessages,
        max_tokens: input.delivery === "text" ? 260 : 190,
        temperature: 0.68,
        top_p: 0.86,
        top_k: 40,
        repetition_penalty: 1.1,
      } as never)));
    let reply = await run(messages);
    if (isInvalidCompanionReply(reply, latestUserMessage, suppressQuestions)) {
      reply = await run([
        {
          role: "system",
          content: `/no_think\n${buildCompanionSystemPrompt(input)}\n\nCRITICAL REWRITE: Start with the concrete subject of the user's last message. Preserve every relevant person, fact, pronoun referent, and correction from recent turns even when the language changed. Use only the writing system requested for this turn. Do not start with empathy, agreement, acknowledgment, or any version of “I’m here/listening,” “I hear you,” or “that sounds.” Write an actual conversational reaction, not a supportive holding statement.${suppressQuestions ? " This reply must be a complete statement with no question and no question mark." : ""}`,
        },
        ...input.messages,
      ]);
    }
    if (isInvalidCompanionReply(reply, latestUserMessage, suppressQuestions)) return respond({ error: "The generated reply missed the conversation style." }, 503, { model: MODEL });
    return respond({ reply, model: MODEL }, 200, { model: MODEL, delivery: input.delivery ?? "text" });
  } catch (error) {
    console.error("Companion inference failed", error instanceof Error ? error.message : "unknown error");
    if (error instanceof EdgeRequestError) return edgeError(requestId, "companion-chat", startedAt, error);
    return respond({ error: "Mira could not form a fresh reply just now." }, 503, { model: MODEL });
  }
}
