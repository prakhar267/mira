import { authorizeInference } from "@/lib/inference-policy";
import {
  assertEdgeSameOrigin,
  edgeError,
  edgeJson,
  edgeRateLimited,
  EdgeRequestError,
  readEdgeJson,
} from "@/lib/edge-security";
import {
  selectReflectionEntries,
  reflectionPrompt,
} from "@/lib/journal-reflection";
import { withInferenceCapacity } from "@/lib/capacity";
import { withProviderDeadline } from "@/lib/provider-resilience";
import { readChatStream } from "@/lib/chat-stream";
import { unsafeCompanionOutput } from "@/lib/companion-safety";
import { discardUnusedRequestBody } from "@/lib/unused-request-body";
import { cloudflareAiError } from "@/lib/cloudflare-ai-error";

export async function POST(request: Request) {
  const started = Date.now(),
    id = crypto.randomUUID();
  try {
    assertEdgeSameOrigin(request);
    const principal = await authorizeInference(request, "chat");
    if (await edgeRateLimited(request, "journal-reflection", 4, 300))
      throw new EdgeRequestError(
        "Please wait a few minutes before creating another reflection.",
        429,
      );
    const body = await readEdgeJson(request, 110000);
    const selected = selectReflectionEntries(
      body,
      principal.state?.journalEntries,
    );
    const fingerprint = JSON.stringify(selected.entries);
    const check = async () => {
      request.signal.throwIfAborted();
      const current = await authorizeInference(request, "chat");
      if (
        current.id !== principal.id ||
        JSON.stringify(
          selectReflectionEntries(body, current.state?.journalEntries).entries,
        ) !== fingerprint
      )
        throw new EdgeRequestError(
          "Your selected entries changed. Select them again before generating a reflection.",
          409,
          "JOURNAL_CHANGED",
        );
    };
    const { env } = await import(
      /* webpackIgnore: true */ "cloudflare:workers"
    );
    const messages = reflectionPrompt(selected.entries, selected.language);
    const summary = await withInferenceCapacity(
      "chat",
      principal,
      Math.ceil(JSON.stringify(messages).length / 4) + 900,
      () =>
        withProviderDeadline(
          "cloudflare-chat",
          async (signal) => {
            await check();
            signal.throwIfAborted();
            const result = await env.AI.run(
              "@cf/google/gemma-4-26b-a4b-it",
              {
                messages,
                stream: true,
                max_completion_tokens: 900,
                temperature: 0.35,
                chat_template_kwargs: { enable_thinking: false },
              },
              { rejectIfBusy: true },
            );
            if (result instanceof ReadableStream)
              return readChatStream(result, signal, false, async () => {
                signal.throwIfAborted();
              });
            const body = result as {
              response?: string;
              choices?: { message?: { content?: string } }[];
            };
            return body.response ?? body.choices?.[0]?.message?.content ?? "";
          },
          20000,
          request.signal,
        ),
    );
    await check();
    if (
      typeof summary !== "string" ||
      !summary.trim() ||
      summary.length > 6000 ||
      unsafeCompanionOutput(summary) ||
      /<\/?(?:think|script|iframe)\b/i.test(summary)
    )
      throw new EdgeRequestError(
        "This reflection could not be completed. Your entries are unchanged; please retry.",
        503,
      );
    return edgeJson(id, "journal-reflection", started, {
      summary: summary.trim(),
      language: selected.language,
      entryIds: selected.entries.map((entry) => entry.id),
    });
  } catch (cause) {
    return edgeError(id, "journal-reflection", started, cloudflareAiError(cause) ?? cause);
  } finally {
    await discardUnusedRequestBody(request);
  }
}
