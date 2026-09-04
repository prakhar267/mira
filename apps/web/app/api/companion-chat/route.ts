import { buildCompanionSystemPrompt, buildMemoryRecallReply, isInvalidCompanionReply, isMemoryRecallRequest, requestsListeningOnly, sanitizeCompanionReply, type EdgeCompanionRequest } from "@/lib/companion-prompt";

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const windowMs = 60_000;
const requestWindows = new Map<string, { count: number; startedAt: number }>();

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

function rateLimited(request: Request) {
  const key = request.headers.get("cf-connecting-ip") ?? "local";
  const now = Date.now();
  const current = requestWindows.get(key);
  if (!current || now - current.startedAt >= windowMs) {
    requestWindows.set(key, { count: 1, startedAt: now });
    return false;
  }
  current.count += 1;
  return current.count > 24;
}

export async function POST(request: Request) {
  if (rateLimited(request)) return Response.json({ error: "Please give Mira a moment before sending more." }, { status: 429 });
  const input = parseRequest(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "Invalid conversation request." }, { status: 400 });
  const latestUserMessage = input.messages.at(-1)?.content ?? "";
  if (isMemoryRecallRequest(latestUserMessage)) return Response.json({ reply: buildMemoryRecallReply(input), model: "memory" });

  try {
    const { env } = await import(/* webpackIgnore: true */ "cloudflare:workers");
    const suppressQuestions = input.responsePreferences?.questionFrequency === "rare" || requestsListeningOnly(latestUserMessage);
    const messages = [
      { role: "system", content: buildCompanionSystemPrompt(input) },
      ...input.messages,
    ];
    const run = async (promptMessages: typeof messages) => sanitizeCompanionReply(readModelText(await env.AI.run(MODEL as never, {
        messages: promptMessages,
        max_tokens: input.delivery === "text" ? 220 : 150,
        temperature: 0.72,
        top_p: 0.88,
        repetition_penalty: 1.1,
      } as never)));
    let reply = await run(messages);
    if (isInvalidCompanionReply(reply, latestUserMessage, suppressQuestions)) {
      reply = await run([
        {
          role: "system",
          content: `${buildCompanionSystemPrompt(input)}\n\nCRITICAL REWRITE: Start with the concrete subject of the user's last message. Do not start with empathy, agreement, acknowledgment, or any version of “I’m here/listening,” “I hear you,” or “that sounds.” Write an actual conversational reaction, not a supportive holding statement.${suppressQuestions ? " This reply must be a complete statement with no question and no question mark." : ""}`,
        },
        ...input.messages,
      ]);
    }
    if (isInvalidCompanionReply(reply, latestUserMessage, suppressQuestions)) return Response.json({ error: "The generated reply missed the conversation style." }, { status: 503 });
    return Response.json({ reply, model: MODEL });
  } catch (error) {
    console.error("Companion inference failed", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "Mira could not form a fresh reply just now." }, { status: 503 });
  }
}
