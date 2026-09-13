import { storeAction } from "./cloud-store";
import { EdgeRequestError } from "./edge-security";
import type { InferencePrincipal, InferenceService } from "./inference-policy";

/** Attempts and estimated cost units are charged before provider execution and
 * not refunded for failures/cancellation: the provider may already have worked.
 * Leases release separately and expire after crashes. These are estimates, not
 * a provider invoice or verified audio duration. */
export async function reserveCapacity(service: InferenceService, principal: InferencePrincipal, units: number) {
  const { env } = await import(/* webpackIgnore: true */ "cloudflare:workers");
  const configured = service === "chat" ? env.CHAT_DAILY_LIMIT : service === "speech" ? env.SPEECH_DAILY_LIMIT : service === "transcribe" ? env.TRANSCRIBE_DAILY_LIMIT : 600;
  const max = Math.max(1, Math.min(10000, Number(configured) || 600));
  const unitPerAttempt = service === "chat" ? 4000 : service === "speech" ? 300 : service === "transcribe" ? 30 : 5000;
  const attemptId = crypto.randomUUID();
  const result = await storeAction<{ allowed: boolean; reason?: string; retryAfter?: number }>({ action: "inferenceReserve", service, tier: principal.mode, principal: principal.id, attemptId, units: Math.max(1, Math.ceil(units)), max, personalMax: principal.mode === "demo" ? 40 : 180, unitMax: max * unitPerAttempt, personalUnitMax: (principal.mode === "demo" ? 40 : 180) * unitPerAttempt, demoMax: Math.floor(max * .4), concurrency: principal.mode === "demo" ? 1 : 2, globalConcurrency: 12, demoConcurrency: 4, ttl: 40 });
  if (!result.allowed) {
    const concurrency = result.reason === "concurrency";
    throw new EdgeRequestError(concurrency ? "Another request is still running. Please give it a moment." : "This session or the shared beta has reached today's capacity. Please try again after midnight UTC. Saved data is safe.", 429, concurrency ? "INFERENCE_BUSY" : "DAILY_CAPACITY_EXHAUSTED", Math.max(1, result.retryAfter ?? (concurrency ? 40 : Math.ceil((86400000 - Date.now() % 86400000) / 1000))));
  }
  return async () => { await storeAction({ action: "inferenceRelease", attemptId }).catch(() => undefined); };
}
export async function withInferenceCapacity<T>(service: InferenceService, principal: InferencePrincipal, units: number, work: () => Promise<T>) {
  const release = await reserveCapacity(service, principal, units);
  let unresolvedUpstream = false;
  try { return await work(); }
  catch (cause) {
    // A Workers AI binding cannot guarantee upstream compute was canceled.
    // Keep the short lease until expiry after timeout/abort to avoid creating
    // unlimited concurrent provider work by repeatedly canceling the browser.
    unresolvedUpstream = cause instanceof Error && ["AbortError", "TimeoutError"].includes(cause.name);
    throw cause;
  } finally { if (!unresolvedUpstream) await release(); }
}
