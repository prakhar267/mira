import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), remove: vi.fn(), requireAccount: vi.fn(), readState: vi.fn() }));
vi.mock("./cloud-store", () => ({ cloudStore: { get: mocks.get, put: mocks.put, delete: mocks.remove }, storeAction: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("./account-server", () => ({
  AccountError: class extends Error { constructor(message: string, readonly status: number) { super(message); } },
  requireAccount: mocks.requireAccount, readState: mocks.readState,
  sha256: async (value: string) => `hashed-${value}`,
}));
import { authorizeInference, createDemoSession, revokeDemoSession, inferenceCapabilities, INFERENCE_POLICY_VERSION } from "./inference-policy";
import { AccountError } from "./account-server";
import { freshDemo } from "./demo-storage";
const token = "a".repeat(43);
const req = (cookie = "") => new Request("https://mira.test/api/companion-chat", { headers: { cookie } });
describe("authoritative inference policy", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("rejects absent, expired, stale-version and withdrawn demo sessions", async () => {
    await expect(authorizeInference(req())).rejects.toMatchObject({ status: 401, code: "DEMO_SESSION_REQUIRED" });
    for (const session of [null, { expiresAt: "2000-01-01" }, { expiresAt: "2099-01-01", policyVersion: "old", adultDeclared: true, aiProcessingConsent: true }, { expiresAt: "2099-01-01", policyVersion: INFERENCE_POLICY_VERSION, adultDeclared: true, aiProcessingConsent: false }]) {
      mocks.get.mockResolvedValue(JSON.stringify(session));
      await expect(authorizeInference(req(`__Host-mira_demo=${token}`))).rejects.toMatchObject({ status: 401 });
    }
  });
  it("records explicit consent/version and expires a server-issued opaque cookie", async () => {
    const created = await createDemoSession(false);
    expect(created.cookie).toContain("HttpOnly; Secure; SameSite=Strict");
    expect(created.cookie).toContain("Max-Age=3600");
    expect(created.session).toMatchObject({ policyVersion: INFERENCE_POLICY_VERSION, adultDeclared: true, aiProcessingConsent: true, memoryConsent: false });
    expect(mocks.put).toHaveBeenCalledWith(expect.stringContaining("demo-session:hashed-"), expect.any(String), { expirationTtl: 3600 });
    await revokeDemoSession(req(`__Host-mira_demo=${token}`));
    expect(mocks.remove).toHaveBeenCalledWith(`demo-session:hashed-${token}`);
  });
  it("does not downgrade a revoked account cookie into valid demo access", async () => {
    mocks.requireAccount.mockRejectedValue(new AccountError("revoked", 401));
    await expect(authorizeInference(req(`__Host-companaro_session=revoked; __Host-mira_demo=${token}`))).rejects.toMatchObject({ status: 401, code: "SESSION_EXPIRED" });
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it("requires adult/current-policy/stored processing consent and optional memory consent", async () => {
    const state = freshDemo(); state.user.id = "owner"; state.user.adultConfirmed = true;
    mocks.requireAccount.mockResolvedValue({ account: { id: "owner" } }); mocks.readState.mockResolvedValue(state);
    const accountRequest = req("__Host-companaro_session=valid");
    mocks.get.mockResolvedValue(null);
    await expect(authorizeInference(accountRequest)).rejects.toMatchObject({ code: "POLICY_CONFIRMATION_REQUIRED" });
    mocks.get.mockResolvedValue(JSON.stringify({ termsVersion: INFERENCE_POLICY_VERSION, adultDeclaredAt: "2026-09-13", aiProcessingConsent: false }));
    await expect(authorizeInference(accountRequest)).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    mocks.get.mockResolvedValue(JSON.stringify({ termsVersion: INFERENCE_POLICY_VERSION, adultDeclaredAt: "2026-09-13", aiProcessingConsent: true, memoryEnabled: false }));
    expect(await authorizeInference(accountRequest, "chat")).toMatchObject({ id: "owner", memoryConsent: false });
    await expect(authorizeInference(accountRequest, "memory")).rejects.toMatchObject({ code: "MEMORY_CONSENT_REQUIRED" });
    expect(inferenceCapabilities(await authorizeInference(accountRequest)).capabilities).toMatchObject({ chat: true, memoryRetrieval: false, imageGeneration: false, billing: false });
  });
});
