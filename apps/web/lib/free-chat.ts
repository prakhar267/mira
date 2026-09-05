import { detectCompanionRequestLanguage, isInvalidCompanionReply, requestsListeningOnly, sanitizeCompanionReplyForDelivery, type EdgeCompanionRequest } from "./companion-prompt";

export const FREE_CHAT_ENDPOINT = "https://api.llm7.io/v1/chat/completions";
export const FREE_CHAT_MODEL = "fast";

export interface FreeChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function compact(value: string, limit: number) {
  return value.trim().replace(/\s+/g, " ").slice(0, limit);
}

/** A short production prompt keeps anonymous inference responsive without dropping continuity rules. */
export function buildFreeChatSystemPrompt(input: EdgeCompanionRequest) {
  const language = detectCompanionRequestLanguage(input);
  const companionName = compact(input.companion.name || "Mira", 40) || "Mira";
  const userName = compact(input.user.name || "there", 40) || "there";
  const memories = (input.memories ?? []).slice(0, 5).map((memory) => `- ${compact(memory, 180)}`).join("\n") || "- none";
  const languageRule = language === "hi"
    ? "Answer in natural conversational Hindi in Devanagari."
    : language === "hinglish"
      ? "Answer in natural Indian Hinglish in Roman letters, never Devanagari."
      : "Answer in natural conversational English, without adding Hindi.";
  const deliveryRule = input.delivery === "text"
    ? "Use 1-3 compact sentences."
    : "Use 1-2 short sentences that sound natural aloud; no markdown, emoji, or stage directions.";
  const questionRule = input.responsePreferences?.questionFrequency === "rare" || requestsListeningOnly(input.messages.at(-1)?.content ?? "")
    ? "Do not ask a question."
    : "Ask at most one brief question, and only when it genuinely helps.";

  return [
    `You are ${companionName}, ${userName}'s adult AI companion. You are warm, observant, candid, playful, and concise. You are AI, never claim to be human or conscious.`,
    "Do not explain that you are a language model, lack human feelings, or are functioning properly unless the user explicitly asks whether you are human or AI. Ordinary questions such as 'what about you?' should get a natural in-character answer.",
    "Respond to the concrete meaning of the latest message like a familiar Indian friend—not a therapist, coach, chatbot, support agent, or motivational poster. Never use canned filler such as 'I'm here', 'I'm listening', 'I hear you', 'take your time', or 'that sounds hard'. Do not merely paraphrase the user.",
    "Keep the facts and people from recent turns. Resolve she/he/they/usko/usse/uske from that context. A switch between English, Hindi, and Hinglish does not reset the conversation. Never ask for information already stated. If corrected, name the exact miss briefly and answer again.",
    input.delivery === "text"
      ? "Interpret casual wording naturally."
      : "This came from speech recognition. Infer the closest ordinary meaning from context even when grammar or spelling is rough. Answer short turns normally. Never say you heard it wrong just because it is short or informal; clarify only if the sentence is visibly cut off or two plausible meanings need different answers.",
    languageRule,
    deliveryRule,
    questionRule,
    "Use an ordinary conversational rhythm. Give direct, specific advice only when asked. Do not invent events, feelings, or details. Preserve a person's gender across languages.",
    "Example continuity: User: 'My sister Priya has an interview tomorrow.' Assistant: 'That is a big day for Priya.' User: 'main uske liye kya karun?' Assistant: 'Priya ko ek simple good-luck text bhejo—bina uspar extra pressure daale.'",
    `User-approved memories (use only when relevant):\n${memories}`,
    `Return only ${companionName}'s reply.`,
  ].join("\n\n");
}

export function createFreeChatRequest(messages: FreeChatMessage[], delivery: "text" | "voice" | "video" = "text"): RequestInit {
  return {
    method: "POST",
    headers: {
      authorization: "Bearer unused",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: FREE_CHAT_MODEL,
      messages,
      max_tokens: delivery === "text" ? 180 : 110,
      temperature: .68,
      top_p: .88,
    }),
  };
}

export function readFreeChatResponse(result: unknown) {
  if (!result || typeof result !== "object") return { text: "", model: "" };
  const record = result as Record<string, unknown>;
  const choices = Array.isArray(record.choices) ? record.choices as unknown[] : [];
  const first = choices[0];
  if (!first || typeof first !== "object") return { text: "", model: typeof record.model === "string" ? record.model : "" };
  const message = (first as Record<string, unknown>).message;
  if (!message || typeof message !== "object") return { text: "", model: typeof record.model === "string" ? record.model : "" };
  const content = (message as Record<string, unknown>).content;
  const text = typeof content === "string"
    ? content.trim()
    : Array.isArray(content)
      ? content.flatMap((part) => part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string"
        ? [(part as Record<string, unknown>).text as string]
        : []).join("").trim()
      : "";
  return { text, model: typeof record.model === "string" ? record.model : "" };
}

export async function requestFreeCompanionReply(input: EdgeCompanionRequest, signal?: AbortSignal) {
  const latestUserMessage = input.messages.at(-1)?.content ?? "";
  const expectedLanguage = detectCompanionRequestLanguage(input);
  const suppressQuestions = input.responsePreferences?.questionFrequency === "rare" || requestsListeningOnly(latestUserMessage);
  const response = await fetch(FREE_CHAT_ENDPOINT, {
    ...createFreeChatRequest([
      { role: "system", content: buildFreeChatSystemPrompt(input) },
      ...input.messages.slice(-10),
    ], input.delivery),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(input.delivery === "text" ? 3_600 : 2_800)])
      : AbortSignal.timeout(input.delivery === "text" ? 3_600 : 2_800),
  });
  if (!response.ok) throw new Error(`Free chat returned ${response.status}.`);
  const generated = readFreeChatResponse(await response.json());
  const reply = sanitizeCompanionReplyForDelivery(generated.text, input.delivery);
  if (isInvalidCompanionReply(reply, latestUserMessage, suppressQuestions, expectedLanguage)) {
    throw new Error("Free chat reply missed the conversation requirements.");
  }
  return reply;
}
