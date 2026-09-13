import { buildDayCheckInReply, buildIdentityReply, buildMemoryRecallReply, canUseSavedMemoryReply, detectCompanionRequestLanguage, isIdentityRequest, isInvalidCompanionReply, requestsListeningOnly, sanitizeCompanionReplyForDelivery } from "@/lib/companion-prompt";
import { assertEdgeSameOrigin, edgeError, edgeJson, edgeRateLimited, readEdgeJson, EdgeRequestError } from "@/lib/edge-security";
import { buildFreeChatMessages } from "@/lib/free-chat";
import { withProviderDeadline } from "@/lib/provider-resilience";
import { withInferenceCapacity } from "@/lib/capacity";
import { readChatStream } from "@/lib/chat-stream";
import { authorizeInference } from "@/lib/inference-policy";
import { parseChatPayload } from "@/lib/inference-payloads";
import { assessCompanionSafety, safeOutputReplacement, unsafeCompanionOutput } from "@/lib/companion-safety";
import { assertCurrentMemoryContext } from "@/lib/inference-context";

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

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

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const respond = (body: unknown, status = 200, details: Record<string, unknown> = {}) => edgeJson(requestId, "companion-chat", startedAt, body, status, details);
  try {
    assertEdgeSameOrigin(request);
    const principal = await authorizeInference(request, "chat");
    if (await edgeRateLimited(request, "companion-chat", 24)) return respond({ error: "Please give Mira a moment before sending more." }, 429, { limited: true });
    const input = parseChatPayload(await readEdgeJson(request, 120_000), principal);
    const selectedContext = (input.memories ?? []).map(content => ({ content }));
    const recheckContext = async () => {
      assertCurrentMemoryContext(await authorizeInference(request, "chat"), selectedContext);
      request.signal.throwIfAborted();
    };
    const latestUserMessage = input.messages.at(-1)?.content ?? "";
    const expectedLanguage = detectCompanionRequestLanguage(input);
    const safeReply = (reply: string, model: string) => {
      const unsafe = unsafeCompanionOutput(reply);
      return respond({ reply: unsafe ? safeOutputReplacement(unsafe, expectedLanguage) : reply, model: unsafe ? "safety" : model }, 200, { model: unsafe ? "safety" : model, ...(unsafe ? { guard: unsafe } : {}) });
    };
    const safety = assessCompanionSafety(input.messages, expectedLanguage);
    if (safety) return respond({ reply: safety.reply, model: "safety" }, 200, { guard: safety.category });
    if (isIdentityRequest(latestUserMessage)) return safeReply(buildIdentityReply(input.companion.name, expectedLanguage), "identity");
    if (canUseSavedMemoryReply(input)) {
      // Body streaming also yields after the initial account snapshot. Direct
      // recall must respect a withdrawal during that wait, without a provider.
      await recheckContext();
      return safeReply(buildMemoryRecallReply(input), "memory");
    }
    const { env } = await import(/* webpackIgnore: true */ "cloudflare:workers");
    const suppressQuestions = input.responsePreferences?.questionFrequency === "rare" || requestsListeningOnly(latestUserMessage);
    const dayReply = buildDayCheckInReply(latestUserMessage, expectedLanguage);
    if (dayReply && !suppressQuestions) return respond({reply:dayReply,model:"day-check-in"},200,{model:"day-check-in",language:expectedLanguage});
    const messages = buildFreeChatMessages(input);
    const responseTokenLimit = input.delivery === "text" ? (input.responsePreferences?.responseLength === "deep" ? 500 : 260) : 190;
    const validReply = (reply: string) => !isInvalidCompanionReply(reply, latestUserMessage, suppressQuestions, expectedLanguage);
    // Anonymous LLM7 is not an approved downstream production service. Use the
    // project's existing Workers AI binding without exposing conversations to it.
    const runCloudflare = async (promptMessages: typeof messages) => sanitizeCompanionReplyForDelivery(readModelText(await withInferenceCapacity("chat", principal, promptMessages.reduce((count, message) => count + Math.ceil(message.content.length / 4), responseTokenLimit), () => withProviderDeadline("cloudflare-chat", async (signal) => {
      await recheckContext();
      const generated: unknown = await env.AI.run(MODEL as never, {
        messages: promptMessages,
        stream: true,
        max_tokens: responseTokenLimit,
        temperature: 0.68,
        top_p: 0.86,
        top_k: 40,
        repetition_penalty: 1.1,
      } as never);
      return generated instanceof ReadableStream ? readChatStream(generated, signal, input.delivery !== "text") : generated;
    }, Math.max(500, Math.min(8_000, 8_500 - (Date.now() - startedAt))), request.signal))), input.delivery);
    let reply = await runCloudflare(messages);
    await recheckContext();
    let unsafe = unsafeCompanionOutput(reply);
    if (unsafe) return respond({ reply: safeOutputReplacement(unsafe, expectedLanguage), model: "safety" }, 200, { guard: unsafe });
    if (!validReply(reply) && Date.now() - startedAt < 5_000) {
      // One bounded repair for a wrong-script/style draft, never a retry loop.
      // It uses the same approved provider and counts against the upstream cap.
      const language = expectedLanguage === "hi" ? "Hindi in Devanagari" : expectedLanguage === "hinglish" ? "Hindi mixed with English, using Roman letters ONLY" : "English ONLY";
      reply = await runCloudflare([
        ...messages,
        {role:"assistant",content:reply},
        {role:"user",content:`Rewrite your last reply in ${language}. Preserve its concrete meaning and the people from our conversation. Use feminine first-person grammar for Mira. ${suppressQuestions ? "No questions or requests for more information." : "One or two short sentences."} Only the rewritten reply, no explanation.`},
      ]);
      await recheckContext();
    }
    unsafe = unsafeCompanionOutput(reply);
    if (unsafe) return respond({ reply: safeOutputReplacement(unsafe, expectedLanguage), model: "safety" }, 200, { guard: unsafe });
    request.signal.throwIfAborted();
    if (!validReply(reply)) return respond({ error: "The generated reply missed the conversation style." }, 503, { model: MODEL, language: expectedLanguage });
    return respond({ reply, model: MODEL }, 200, { model: MODEL, provider: "cloudflare", language: expectedLanguage, delivery: input.delivery ?? "text" });
  } catch (error) {
    console.error(JSON.stringify({ event: "provider_failure", requestId, route: "companion-chat" }));
    if (error instanceof EdgeRequestError) return edgeError(requestId, "companion-chat", startedAt, error);
    return respond({ error: "Mira could not form a fresh reply just now." }, 503, { model: MODEL });
  }
}
