import { buildDayCheckInReply, buildIdentityReply, buildMemoryRecallReply, canUseSavedMemoryReply, companionReplyIssue, detectCompanionRequestLanguage, isIdentityRequest, isInvalidCompanionReply, requestsListeningOnly, sanitizeCompanionReplyForDelivery } from "@/lib/companion-prompt";
import { assertEdgeSameOrigin, edgeError, edgeJson, edgeRateLimited, readEdgeJson, EdgeRequestError } from "@/lib/edge-security";
import { buildFreeChatMessages } from "@/lib/free-chat";
import { withProviderDeadline } from "@/lib/provider-resilience";
import { withInferenceCapacity } from "@/lib/capacity";
import { readChatStream } from "@/lib/chat-stream";
import { authorizeInference } from "@/lib/inference-policy";
import { parseChatPayload } from "@/lib/inference-payloads";
import { assessCompanionSafety, safeOutputReplacement, unsafeCompanionOutput } from "@/lib/companion-safety";
import { assertCurrentMemoryContext } from "@/lib/inference-context";
import { chatDeliveryStream } from "@/lib/chat-delivery-stream";
import { CHAT_STREAM_TYPE } from "@/lib/chat-stream-protocol";
import { discardUnusedRequestBody } from "@/lib/unused-request-body";
import { groundReplyPerspective } from "@/lib/reply-perspective";
import { isClosingThanks, isFactCorrection, replyGroundingIssue } from "@/lib/conversation-focus";

const MODEL = "@cf/google/gemma-4-26b-a4b-it";

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
    const recheckContext = async (signal = request.signal) => {
      signal.throwIfAborted();
      assertCurrentMemoryContext(await authorizeInference(request, "chat"), selectedContext);
      signal.throwIfAborted();
    };
    const latestUserMessage = input.messages.at(-1)?.content ?? "";
    const expectedLanguage = detectCompanionRequestLanguage(input);
    const incremental = (input.delivery ?? "text") === "text" && request.headers.get("accept")?.includes(CHAT_STREAM_TYPE);
    const deliver = (reply: string, model: string, details: Record<string, unknown> = {}) => incremental
      ? chatDeliveryStream({ requestId, startedAt, signal: request.signal, check: recheckContext, work: async () => ({ reply, model }) })
      : respond({ reply, model }, 200, details);
    const safeReply = (reply: string, model: string) => {
      const unsafe = unsafeCompanionOutput(reply);
      return deliver(unsafe ? safeOutputReplacement(unsafe, expectedLanguage) : reply, unsafe ? "safety" : model, { model: unsafe ? "safety" : model, ...(unsafe ? { guard: unsafe } : {}) });
    };
    const safety = assessCompanionSafety(input.messages, expectedLanguage);
    if (safety) return deliver(safety.reply, "safety", { guard: safety.category });
    if (isIdentityRequest(latestUserMessage)) return safeReply(buildIdentityReply(input.companion.name, expectedLanguage), "identity");
    if (canUseSavedMemoryReply(input)) {
      // Body streaming also yields after the initial account snapshot. Direct
      // recall must respect a withdrawal during that wait, without a provider.
      await recheckContext();
      return safeReply(buildMemoryRecallReply(input), "memory");
    }
    const { env } = await import(/* webpackIgnore: true */ "cloudflare:workers");
    const closingThanks = isClosingThanks(input);
    const suppressQuestions = input.responsePreferences?.questionFrequency === "rare" || requestsListeningOnly(latestUserMessage) || isFactCorrection(input) || closingThanks;
    const dayReply = buildDayCheckInReply(latestUserMessage, expectedLanguage);
    if (dayReply && !suppressQuestions) return deliver(dayReply,"day-check-in",{model:"day-check-in",language:expectedLanguage});
    const messages = buildFreeChatMessages(input);
    const responseTokenLimit = input.delivery === "text" ? (input.responsePreferences?.responseLength === "deep" ? 500 : 260) : 144;
    const validReply = (reply: string) => !isInvalidCompanionReply(reply, latestUserMessage, suppressQuestions, expectedLanguage) && !replyGroundingIssue(input, reply);
    // Anonymous LLM7 is not an approved downstream production service. Use the
    // project's existing Workers AI binding without exposing conversations to it.
    const generate = async (onPrefix?: (prefix: string, providerSignal?: AbortSignal) => Promise<void>, deliverySignal = request.signal) => {
    let emitted = false;
    const checkPartial = onPrefix ? async (raw: string, providerSignal: AbortSignal) => {
      // Never forward raw tokens. Hold the latest complete sentence as
      // lookahead; check both accumulated raw output and the delivered prefix.
      // Reasoning/markup and overlength candidates stay buffered until final.
      if (unsafeCompanionOutput(raw)) throw new EdgeRequestError("This reply could not be safely completed. Retry this turn.", 503, "UNSAFE_STREAM");
      if (/[<>]/u.test(raw) || raw.length > 700) return;
      const text = groundReplyPerspective(input, sanitizeCompanionReplyForDelivery(raw, "text"));
      const sentences = [...text.matchAll(/[^.!?।]+[.!?।](?=\s|$)/gu)];
      if (sentences.length < 2) return;
      const previous = sentences.at(-2)!;
      const prefix = text.slice(0, previous.index! + previous[0].length).trimEnd();
      if (!prefix || unsafeCompanionOutput(prefix) || !validReply(prefix)) return;
      await onPrefix(prefix, providerSignal); emitted = true;
    } : undefined;
    const runCloudflare = async (promptMessages: typeof messages) => readModelText(await withInferenceCapacity("chat", principal, promptMessages.reduce((count, message) => count + Math.ceil(message.content.length / 4), responseTokenLimit), () => withProviderDeadline("cloudflare-chat", async (signal) => {
      await recheckContext(signal);
      const generated: unknown = await env.AI.run(MODEL as never, {
        messages: promptMessages,
        stream: true,
        max_completion_tokens: responseTokenLimit,
        temperature: 0.45,
        top_p: 0.86,
        chat_template_kwargs: { enable_thinking: false },
      } as never);
      return generated instanceof ReadableStream ? readChatStream(generated, signal, input.delivery !== "text", checkPartial ? raw => checkPartial(raw, signal) : undefined, closingThanks ? 1 : 2) : generated;
    }, Math.max(500, Math.min(8_000, 8_500 - (Date.now() - startedAt))), deliverySignal)));
    let raw = await runCloudflare(messages);
    await recheckContext(deliverySignal);
    let unsafe = unsafeCompanionOutput(raw);
    if (unsafe) {
      if (emitted) throw new EdgeRequestError("This reply could not be safely completed. Retry this turn.", 503, "UNSAFE_STREAM");
      return { reply: safeOutputReplacement(unsafe, expectedLanguage), model: "safety" };
    }
    let reply = groundReplyPerspective(input, sanitizeCompanionReplyForDelivery(raw, input.delivery));
    if (!emitted && !validReply(reply) && Date.now() - startedAt < 5_000) {
      const groundingIssue = replyGroundingIssue(input, reply);
      console.log(JSON.stringify({event:"reply_style_repair",requestId,reason:groundingIssue ?? companionReplyIssue(reply,latestUserMessage,suppressQuestions,expectedLanguage),language:expectedLanguage}));
      // One bounded repair for a wrong-script/style draft, never a retry loop.
      // It uses the same approved provider and counts against the upstream cap.
      const language = expectedLanguage === "hi" ? "Hindi in Devanagari" : expectedLanguage === "hinglish" ? "Hindi mixed with English, using Roman letters ONLY" : "English ONLY";
      const scriptRule=expectedLanguage==="hi"?"पूरा जवाब देवनागरी में लिखो। हिंदी के शब्द रोमन में मत लिखो। English technical terms and names may remain separate words.":"";
      raw = await runCloudflare(groundingIssue ? buildFreeChatMessages({ ...input, messages: [input.messages.at(-1)!] }) : [
        ...messages,
        {role:"assistant",content:reply},
        {role:"user",content:`Rewrite your last reply in ${language}. ${scriptRule} Preserve its concrete meaning and the people from our conversation. Use feminine first-person grammar for Mira. ${suppressQuestions ? "No questions or requests for more information." : "One or two short sentences."} Only the rewritten reply, no explanation.`},
      ]);
      await recheckContext(deliverySignal);
      reply = groundReplyPerspective(input, sanitizeCompanionReplyForDelivery(raw, input.delivery));
    }
    unsafe = unsafeCompanionOutput(raw);
    if (unsafe) {
      if (emitted) throw new EdgeRequestError("This reply could not be safely completed. Retry this turn.", 503, "UNSAFE_STREAM");
      return { reply: safeOutputReplacement(unsafe, expectedLanguage), model: "safety" };
    }
    deliverySignal.throwIfAborted();
    if (!validReply(reply)) {
      console.log(JSON.stringify({event:"reply_style_rejected",requestId,reason:replyGroundingIssue(input,reply) ?? companionReplyIssue(reply,latestUserMessage,suppressQuestions,expectedLanguage),language:expectedLanguage}));
      throw new EdgeRequestError("The generated reply missed the conversation style.", 503, "INVALID_REPLY");
    }
    return { reply, model: MODEL };
    };
    if (incremental) return chatDeliveryStream({ requestId, startedAt, signal: request.signal, check: recheckContext, work: generate });
    const result = await generate();
    return respond(result, 200, { model: result.model, provider: "cloudflare", language: expectedLanguage, delivery: input.delivery ?? "text" });
  } catch (error) {
    const timedOut=error instanceof DOMException && error.name==="TimeoutError";
    console.error(JSON.stringify({ event: "provider_failure", requestId, route: "companion-chat", reason:timedOut?"deadline":"request-failed" }));
    if(timedOut)return edgeError(requestId,"companion-chat",startedAt,new EdgeRequestError("The AI provider took too long to respond. Please retry this turn.",503,"PROVIDER_TIMEOUT"));
    if (error instanceof EdgeRequestError) return edgeError(requestId, "companion-chat", startedAt, error);
    return respond({ error: "Mira could not form a fresh reply just now." }, 503, { model: MODEL });
  } finally {
    await discardUnusedRequestBody(request);
  }
}
