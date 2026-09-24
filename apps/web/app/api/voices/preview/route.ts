import { authorizeInference } from "@/lib/inference-policy";
import {
  assertEdgeSameOrigin,
  edgeError,
  edgeRateLimited,
  EdgeRequestError,
} from "@/lib/edge-security";
import { assertVoiceAvailable } from "@/lib/voice-catalog";
import { providerFetch } from "@/lib/provider-fetch";
import { decodeInworldAudio } from "@/lib/inworld-speech";
import { cloudStore } from "@/lib/cloud-store";

export async function GET(request: Request) {
  const started = Date.now(),
    id = crypto.randomUUID();
  try {
    assertEdgeSameOrigin(request);
    await authorizeInference(request, "speech");
    if (await edgeRateLimited(request, "voice-preview", 12))
      throw new EdgeRequestError(
        "Please wait before previewing another voice.",
        429,
      );
    const { env } = await import(
      /* webpackIgnore: true */ "cloudflare:workers"
    );
    const key = env.INWORLD_API_KEY?.trim();
    if (!key)
      throw new EdgeRequestError(
        "Voice previews are temporarily unavailable.",
        503,
      );
    const voice = new URL(request.url).searchParams.get("voiceId") ?? "Priya";
    await assertVoiceAvailable(voice, key, request.signal);
    const cacheKey = `voice-preview:v1:${voice}`;
    let content = await cloudStore.get(cacheKey);
    if (!content) {
      const response = await providerFetch(
        `https://api.inworld.ai/tts/v1/voice:preview?${new URLSearchParams({ voice_id: voice, model_id: "inworld-tts-2-flash" })}`,
        {
          headers: { authorization: `Basic ${key.replace(/^Basic\s+/i, "")}` },
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(10000)]),
        },
      );
      if (!response.ok)
        throw new EdgeRequestError(
          "This voice preview is unavailable. Please try another voice.",
          503,
        );
      const body = (await response.json()) as { audioContent?: unknown };
      if (
        typeof body.audioContent !== "string" ||
        body.audioContent.length > 1_000_000
      )
        throw new Error("Invalid preview");
      decodeInworldAudio(body.audioContent);
      content = body.audioContent;
      await cloudStore.put(cacheKey, content, { expirationTtl: 86400 });
    }
    await authorizeInference(request, "speech");
    request.signal.throwIfAborted();
    return new Response(decodeInworldAudio(content) as unknown as BodyInit, {
      headers: {
        "content-type": "audio/mpeg",
        "cache-control": "private, max-age=3600",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (cause) {
    return edgeError(id, "voice-preview", started, cause);
  }
}
