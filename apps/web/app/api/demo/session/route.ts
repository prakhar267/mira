import { assertEdgeSameOrigin, EdgeRequestError, edgeError, edgeJson, edgeRateLimited, readEdgeJson } from "@/lib/edge-security";
import { createDemoSession, revokeDemoSession, INFERENCE_POLICY_VERSION } from "@/lib/inference-policy";

export async function POST(request: Request) {
  const started = Date.now(), id = crypto.randomUUID();
  try {
    assertEdgeSameOrigin(request);
    if (await edgeRateLimited(request, "demo-session", 6, 3600)) throw new EdgeRequestError("Too many demo sessions. Please try again later.", 429, "DEMO_SESSION_LIMIT", 3600);
    const input = await readEdgeJson(request, 1000) as Record<string, unknown> | null;
    if (!input || Array.isArray(input) || input.adultDeclared !== true || input.aiProcessingConsent !== true || typeof input.memoryConsent !== "boolean" || input.policyVersion !== INFERENCE_POLICY_VERSION || Object.keys(input).some(key => !["adultDeclared", "aiProcessingConsent", "memoryConsent", "policyVersion"].includes(key))) throw new EdgeRequestError("Confirm that you are 18 or older and accept the current AI processing disclosure.", 400, "POLICY_CONFIRMATION_REQUIRED");
    await revokeDemoSession(request);
    const result = await createDemoSession(input.memoryConsent);
    return edgeJson(id, "demo-session", started, { mode: "demo", expiresAt: result.session.expiresAt, policyVersion: INFERENCE_POLICY_VERSION, ageAssurance: "self-declared" }, 201, {}, { "set-cookie": result.cookie });
  } catch (cause) { return edgeError(id, "demo-session", started, cause); }
}
export async function DELETE(request: Request) {
  const started = Date.now(), id = crypto.randomUUID();
  try { assertEdgeSameOrigin(request); return edgeJson(id, "demo-session", started, { revoked: true }, 200, {}, { "set-cookie": await revokeDemoSession(request) }); }
  catch (cause) { return edgeError(id, "demo-session", started, cause); }
}
