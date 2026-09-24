import { authorizeInference } from "@/lib/inference-policy";
import {
  edgeError,
  edgeJson,
  edgeRateLimited,
  EdgeRequestError,
} from "@/lib/edge-security";
import { getVoiceCatalog, normalizeVoiceId } from "@/lib/voice-catalog";

export async function GET(request: Request) {
  const started = Date.now(),
    id = crypto.randomUUID();
  try {
    const principal = await authorizeInference(request, "speech");
    if (await edgeRateLimited(request, "voices", 20))
      throw new EdgeRequestError("Please wait before refreshing voices.", 429);
    const { env } = await import(
      /* webpackIgnore: true */ "cloudflare:workers"
    );
    if (!env.INWORLD_API_KEY?.trim())
      throw new EdgeRequestError(
        "Voice choices are temporarily unavailable.",
        503,
      );
    return edgeJson(id, "voices", started, {
      voices: await getVoiceCatalog(env.INWORLD_API_KEY, request.signal),
      selected: normalizeVoiceId(principal.state?.companion.voiceId),
    });
  } catch (cause) {
    return edgeError(id, "voices", started, cause);
  }
}
