import { AccountError, requireAccount, readState, sha256 } from "./account-server";
import { cloudStore } from "./cloud-store";
import { EdgeRequestError } from "./edge-security";
import type { DemoState } from "./state";

export const INFERENCE_POLICY_VERSION = "2026-09-13";
export const DEMO_COOKIE = "__Host-mira_demo";
export const DEMO_SECONDS = 3600;
export type InferenceService = "chat" | "speech" | "transcribe" | "memory";
export interface InferencePrincipal {
  mode: "account" | "demo";
  id: string;
  memoryConsent: boolean;
  expiresAt?: string;
  state?: DemoState;
}
interface DemoSession {
  id: string;
  expiresAt: string;
  policyVersion: string;
  adultDeclared: true;
  aiProcessingConsent: true;
  memoryConsent: boolean;
}
function cookie(request: Request, name: string) {
  return (request.headers.get("cookie") ?? "").split(";").map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1) ?? "";
}
export function hasAccountSession(request: Request) { return Boolean(cookie(request, "__Host-companaro_session")); }

/** Cookie presence chooses account authorization, never an anonymous downgrade.
 * Origins are only a CSRF signal; neither they nor a client userId authenticate. */
export async function authorizeInference(request: Request, service?: InferenceService): Promise<InferencePrincipal> {
  const { env } = await import(/* webpackIgnore: true */ "cloudflare:workers");
  // Server configuration only: local artifact acceptance must not be able to
  // reach a real provider, even if a fixture accidentally creates a session.
  // The same fail-closed switch can contain a production inference incident.
  if (env.MIRA_INFERENCE_DISABLED === "true") throw new EdgeRequestError("AI processing is temporarily disabled. Your saved data remains available.", 503, "INFERENCE_DISABLED");
  let principal: InferencePrincipal;
  if (hasAccountSession(request)) {
    try {
      const { account } = await requireAccount(request);
      const state = await readState(account.id) as DemoState;
      const rawPolicy = await cloudStore.get(`account-policy:${account.id}`);
      const policy = rawPolicy ? JSON.parse(rawPolicy) as Record<string, unknown> : null;
      if (!policy || policy.termsVersion !== INFERENCE_POLICY_VERSION || !policy.adultDeclaredAt || state.user.adultConfirmed !== true) throw new EdgeRequestError("Please confirm the current adult and processing disclosures in your account.", 403, "POLICY_CONFIRMATION_REQUIRED");
      if (policy.aiProcessingConsent !== true || state.aiProcessingConsent !== true) throw new EdgeRequestError("AI processing is paused. You can still manage or delete your data.", 403, "CONSENT_REQUIRED");
      principal = { mode: "account", id: account.id, state, memoryConsent: policy.memoryEnabled === true && state.memoryEnabled === true };
    } catch (cause) {
      if (cause instanceof AccountError) throw new EdgeRequestError(cause.status === 401 ? "Your session expired. Please sign in again." : "Your account is temporarily unavailable.", cause.status, cause.status === 401 ? "SESSION_EXPIRED" : "ACCOUNT_UNAVAILABLE");
      throw cause;
    }
  } else {
    const token = cookie(request, DEMO_COOKIE);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new EdgeRequestError("Start a demo session after reviewing the adult and AI processing disclosures.", 401, "DEMO_SESSION_REQUIRED");
    const raw = await cloudStore.get(`demo-session:${await sha256(token)}`);
    const session = raw ? JSON.parse(raw) as DemoSession : null;
    if (!session || typeof session.id !== "string" || session.id.length > 100 || !Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= Date.now() || session.policyVersion !== INFERENCE_POLICY_VERSION || session.adultDeclared !== true || session.aiProcessingConsent !== true) throw new EdgeRequestError("Your demo session expired. Review the disclosures to continue.", 401, "DEMO_SESSION_EXPIRED");
    principal = { mode: "demo", id: session.id, memoryConsent: session.memoryConsent === true, expiresAt: session.expiresAt };
  }
  if (service === "memory" && !principal.memoryConsent) throw new EdgeRequestError("Memory processing is paused. Your saved memories remain inspectable and deletable.", 403, "MEMORY_CONSENT_REQUIRED");
  return principal;
}

export async function createDemoSession(memoryConsent: boolean) {
  const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const session: DemoSession = { id: crypto.randomUUID(), expiresAt: new Date(Date.now() + DEMO_SECONDS * 1000).toISOString(), policyVersion: INFERENCE_POLICY_VERSION, adultDeclared: true, aiProcessingConsent: true, memoryConsent };
  await cloudStore.put(`demo-session:${await sha256(token)}`, JSON.stringify(session), { expirationTtl: DEMO_SECONDS });
  return { session, cookie: `${DEMO_COOKIE}=${token}; Max-Age=${DEMO_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Strict` };
}
export async function revokeDemoSession(request: Request) {
  const token = cookie(request, DEMO_COOKIE);
  if (/^[A-Za-z0-9_-]{43}$/.test(token)) await cloudStore.delete(`demo-session:${await sha256(token)}`);
  return `${DEMO_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

/** Free beta capabilities deliberately do not depend on client-supplied plans.
 * Payments are disabled; this is not an entitlement to future paid features. */
export function inferenceCapabilities(principal?: InferencePrincipal, available = { chat: true, transcription: true, speech: true }) {
  const enabled = Boolean(principal);
  return {
    runtime: "cloudflare" as const, mode: principal?.mode ?? "anonymous", policyVersion: INFERENCE_POLICY_VERSION,
    ...(principal?.expiresAt ? { expiresAt: principal.expiresAt } : {}),
    ageAssurance: enabled ? "self-declared" : "none",
    capabilities: { chat: enabled && available.chat, transcription: enabled && available.transcription, speech: enabled && available.speech, voiceCall: enabled && available.chat && available.transcription && available.speech, videoCall: enabled && available.chat && available.transcription && available.speech, memoryRetrieval: (principal?.memoryConsent ?? false) && available.chat, imageUpload: false, imageGeneration: false, imageUnderstanding: false, journalReflection: false, scheduledNotifications: false, billing: false },
    voice: { name: "Priya", customization: false },
  };
}
