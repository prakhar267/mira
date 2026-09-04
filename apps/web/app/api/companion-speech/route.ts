import { assertEdgeSameOrigin, EdgeRequestError, edgeError, edgeJson } from "@/lib/edge-security";

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  try {
    assertEdgeSameOrigin(request);
    return edgeJson(requestId, "companion-speech", startedAt, {
      error: "Speech now runs privately in the browser with Kokoro-82M.",
      model: "onnx-community/Kokoro-82M-v1.0-ONNX",
    }, 410, { retired: true });
  } catch (cause) {
    if (cause instanceof EdgeRequestError) return edgeError(requestId, "companion-speech", startedAt, cause);
    return edgeJson(requestId, "companion-speech", startedAt, { error: "Speech endpoint retired." }, 410, { retired: true });
  }
}
