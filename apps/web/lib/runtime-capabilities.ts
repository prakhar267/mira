export const DEMO_POLICY_VERSION = "2026-09-13";
export type RuntimeMode = "browser-demo" | "cloudflare-account" | "optional-fastify";
export interface CapabilityContract {
  runtime: "cloudflare";
  mode: "account" | "demo" | "anonymous";
  expiresAt?: string;
  capabilities: {
    chat: boolean; transcription: boolean; speech: boolean; voiceCall: boolean; videoCall: boolean;
    memoryRetrieval: boolean; imageUpload: boolean; imageGeneration: boolean; imageUnderstanding: boolean;
    journalReflection: boolean; scheduledNotifications: boolean; billing: boolean;
  };
  voice: { name: string; customization: boolean };
}
export async function fetchCapabilities(signal?: AbortSignal): Promise<CapabilityContract> {
  const response = await fetch("/api/capabilities", { credentials: "same-origin", cache: "no-store", ...(signal ? { signal } : {}) });
  if (!response.ok) throw new Error("Available features could not be checked. Please retry.");
  return response.json() as Promise<CapabilityContract>;
}

// Focus and consent changes can overlap. Only the newest check may update the
// UI, including when a transport completes despite receiving an abort signal.
export class CapabilityRefresh {
  private controller: AbortController | undefined;
  private sequence = 0;
  constructor(private readonly commit: (value: CapabilityContract | null) => void, private readonly request = fetchCapabilities) {}
  async refresh() {
    this.controller?.abort();
    const controller = new AbortController(), sequence = ++this.sequence;
    this.controller = controller;
    try {
      const value = await this.request(controller.signal);
      if (!controller.signal.aborted && sequence === this.sequence) this.commit(value);
    } catch {
      if (!controller.signal.aborted && sequence === this.sequence) this.commit(null);
    }
  }
  stop() { this.sequence++; this.controller?.abort(); }
}
export async function createDemoSession(memoryConsent: boolean) {
  const response = await fetch("/api/demo/session", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ adultDeclared: true, aiProcessingConsent: true, memoryConsent, policyVersion: DEMO_POLICY_VERSION }) });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? "The demo could not be started. Please retry.");
  }
  const capabilities = await fetchCapabilities();
  if (capabilities.mode !== "demo" || !capabilities.capabilities.chat) throw new Error("Demo access could not be confirmed. Enable cookies and try again.");
  window.dispatchEvent(new Event("mira-capabilities-changed"));
  return capabilities;
}
export async function revokeDemoSession() {
  await fetch("/api/demo/session", { method: "DELETE", credentials: "same-origin" });
}
