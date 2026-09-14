import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), rate: vi.fn(), provider: vi.fn(), capacity: vi.fn(), store: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: { AI: { run: mocks.provider }, INWORLD_API_KEY: "synthetic-not-a-secret" } }));
vi.mock("./inference-policy", () => ({ authorizeInference: mocks.authorize }));
vi.mock("./cloud-store", () => ({ storeAction: mocks.store }));
vi.mock("./capacity", () => ({ withInferenceCapacity: mocks.capacity }));
vi.mock("./provider-fetch", () => ({ providerFetch: mocks.provider }));
import { POST as chat } from "../app/api/companion-chat/route";
import { POST as speech } from "../app/api/companion-speech/route";
import { POST as transcribe } from "../app/api/companion-transcribe/route";
import { POST as memory } from "../app/api/companion-memory/route";
import { EdgeRequestError } from "./edge-security";
import { freshDemo } from "./demo-storage";
import type { InferencePrincipal } from "./inference-policy";
const input = { user: { name: "Synthetic" }, companion: { name: "Mira" }, messages: [{ role: "user", content: "I have an interview tomorrow." }], delivery: "text" };
const request = (payload: unknown) => new Request("https://mira.test/api/test", { method: "POST", body: JSON.stringify(payload), headers: { "content-type": "application/json" } });
describe("active inference route boundaries (mock providers)", () => {
  beforeEach(() => {
    vi.resetAllMocks(); mocks.store.mockResolvedValue({ limited: false });
    mocks.authorize.mockResolvedValue({ mode: "demo", id: "synthetic", memoryConsent: true });
    mocks.capacity.mockImplementation((_service, _principal, _units, work) => work());
  });
  for (const [label, route] of [["chat", chat], ["speech", speech], ["transcribe", transcribe], ["memory", memory]] as const) {
    it(`${label} cannot call providers without a valid policy/session`, async () => {
      mocks.authorize.mockRejectedValue(new EdgeRequestError("Session required", 401, "DEMO_SESSION_REQUIRED"));
      const response = await route(request({}));
      expect(response.status).toBe(401); expect(await response.json()).toMatchObject({ code: "DEMO_SESSION_REQUIRED" });
      expect(mocks.provider).not.toHaveBeenCalled(); expect(mocks.capacity).not.toHaveBeenCalled();
    });
    it(`${label} cannot call providers after consent withdrawal`, async () => {
      mocks.authorize.mockRejectedValue(new EdgeRequestError("Consent required", 403, "CONSENT_REQUIRED"));
      const response = await route(request({})); expect(response.status).toBe(403); expect(mocks.provider).not.toHaveBeenCalled();
    });
  }
  it("rejects oversize chat without provider work instead of truncation", async () => {
    const response = await chat(request({ ...input, messages: [{ role: "user", content: "a".repeat(8001) }] }));
    expect(response.status).toBe(413); expect(mocks.provider).not.toHaveBeenCalled();
  });
  it("returns category-specific Hindi support without spending provider capacity", async () => {
    const response = await chat(request({ ...input, messages: [{ role: "user", content: "मुझे जीना नहीं है" }] }));
    const body = await response.json() as { reply: string; model: string };
    expect(body.model).toBe("safety"); expect(body.reply).toContain("सहारा"); expect(mocks.provider).not.toHaveBeenCalled();
  });
  it("does not speak unsafe model output", async () => {
    mocks.provider.mockResolvedValue({ response: "I am a real human and I live near you." });
    const response = await chat(request(input));
    expect(await response.json()).toMatchObject({ model: "safety" });
  });
  it("reserves reranker capacity and fences returned output after consent withdrawal", async () => {
    mocks.provider.mockResolvedValue({ data: [{ id: 0, score: .99 }] });
    mocks.authorize.mockResolvedValueOnce({ mode: "demo", id: "synthetic", memoryConsent: true }).mockResolvedValueOnce({ mode: "demo", id: "synthetic", memoryConsent: true }).mockRejectedValueOnce(new EdgeRequestError("Memory paused", 403, "MEMORY_CONSENT_REQUIRED"));
    const response = await memory(request({ query: "tea", memories: [{ id: "m", content: "Likes tea" }] }));
    expect(mocks.capacity).toHaveBeenCalledWith("memory", expect.any(Object), expect.any(Number), expect.any(Function));
    expect(response.status).toBe(403);
  });
  it("does not deliver a result after account processing is withdrawn mid-generation", async () => {
    mocks.authorize.mockResolvedValueOnce({ mode: "demo", id: "synthetic", memoryConsent: true }).mockResolvedValueOnce({ mode: "demo", id: "synthetic", memoryConsent: true }).mockRejectedValueOnce(new EdgeRequestError("Processing paused", 403, "CONSENT_REQUIRED"));
    mocks.provider.mockResolvedValue({ response: "Let's practice one interview question together." });
    const response = await chat(request(input));
    expect(mocks.provider).toHaveBeenCalledOnce(); expect(response.status).toBe(403);
  });
  for (const routeName of ["chat", "memory", "direct recall"] as const) {
    for (const change of ["paused", "deleted", "corrected"] as const) {
      for (const phase of ["before provider", "during provider"] as const) {
        if (routeName === "direct recall" && phase === "during provider") continue;
        it(`${routeName} fences memory ${change} ${phase}`, async () => {
          const state = freshDemo(); state.user.id = "owner"; state.user.adultConfirmed = true;
          state.memories = [{ id: "owned", userId: "owner", companionId: "c", type: "semantic", content: "My plant is named Cedar.", normalizedContent: "my plant is named cedar.", importance: .5, confidence: .8, sourceMessageIds: [], createdAt: "2026-09-13", updatedAt: "2026-09-13", retrievalCount: 0, status: "active", pinned: false }];
          const principal: InferencePrincipal = { mode: "account", id: "owner", memoryConsent: true, state };
          const changed = structuredClone(principal);
          if (change === "paused") changed.memoryConsent = false;
          if (change === "deleted") changed.state!.memories = [];
          if (change === "corrected") changed.state!.memories[0]!.content = "My plant is named Maple.";
          mocks.authorize.mockResolvedValueOnce(principal);
          if (phase === "during provider") mocks.authorize.mockResolvedValueOnce(principal);
          mocks.authorize.mockResolvedValue(changed);
          mocks.provider.mockResolvedValue(routeName === "chat" ? { response: "Let's practice one interview question together." } : { data: [{ id: 0, score: .99 }] });
          const response = await (routeName === "direct recall" ? chat(request({ ...input, messages: [{ role: "user", content: "What do you remember about me?" }] })) : routeName === "chat" ? chat(request(input)) : memory(request({ query: "plant", memories: [{ id: "owned", content: "My plant is named Cedar." }] })));
          expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: "CONTEXT_CHANGED" });
          expect(mocks.provider).toHaveBeenCalledTimes(phase === "before provider" ? 0 : 1);
        });
      }
    }
  }
});
