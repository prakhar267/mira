import { authorizeInference, inferenceCapabilities } from "@/lib/inference-policy";
import { EdgeRequestError, edgeError, edgeJson } from "@/lib/edge-security";
export async function GET(request: Request) {
  const started = Date.now(), id = crypto.randomUUID();
  try {
    const principal = await authorizeInference(request);
    const { env } = await import(/* webpackIgnore: true */ "cloudflare:workers");
    return edgeJson(id, "capabilities", started, inferenceCapabilities(principal, { chat: Boolean(env.AI), transcription: Boolean(env.INWORLD_API_KEY || env.AI), speech: Boolean(env.INWORLD_API_KEY?.trim()) }));
  }
  catch (cause) {
    if (cause instanceof EdgeRequestError && (cause.status === 401 || cause.status === 403)) return edgeJson(id, "capabilities", started, { ...inferenceCapabilities(), reason: cause.code });
    return edgeError(id, "capabilities", started, cause);
  }
}
