import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ env: { MIRA_INFERENCE_DISABLED: "true", INWORLD_API_KEY: "synthetic-only" }, get: vi.fn(), account: vi.fn(), state: vi.fn(), store: vi.fn(), provider: vi.fn(), capacity: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: { ...mocks.env, get MIRA_INFERENCE_DISABLED() { return mocks.env.MIRA_INFERENCE_DISABLED; }, AI: { run: mocks.provider } } }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("./cloud-store", () => ({ cloudStore: { get: mocks.get }, storeAction: mocks.store }));
vi.mock("./account-server", () => ({ AccountError: class extends Error {}, requireAccount: mocks.account, readState: mocks.state, sha256: vi.fn() }));
vi.mock("./capacity", () => ({ withInferenceCapacity: mocks.capacity }));
vi.mock("./provider-fetch", () => ({ providerFetch: mocks.provider }));

import { POST as chat } from "../app/api/companion-chat/route";
import { POST as speech } from "../app/api/companion-speech/route";
import { POST as transcribe } from "../app/api/companion-transcribe/route";
import { POST as memory } from "../app/api/companion-memory/route";
import { GET as capabilities } from "../app/api/capabilities/route";
import { authorizeInference, INFERENCE_POLICY_VERSION } from "./inference-policy";
import { freshDemo } from "./demo-storage";

const request = () => new Request("https://mira.test/api/test", { method: "POST", headers: { cookie: "__Host-companaro_session=synthetic-valid-account", "content-type": "application/json" }, body: "{}" });
describe("server-enforced inference shutdown (actual policy and routes, synthetic stores/providers)", () => {
  beforeEach(() => {
    vi.resetAllMocks(); mocks.env.MIRA_INFERENCE_DISABLED = "true";
    const state = freshDemo(); state.user.id = "owner"; state.user.adultConfirmed = true; state.aiProcessingConsent = true; state.memoryEnabled = true;
    mocks.account.mockResolvedValue({ account: { id: "owner" } }); mocks.state.mockResolvedValue(state);
    mocks.get.mockResolvedValue(JSON.stringify({ termsVersion: INFERENCE_POLICY_VERSION, adultDeclaredAt: "2026-09-13", aiProcessingConsent: true, memoryEnabled: true }));
  });
  for (const [name, route] of [["chat", chat], ["speech", speech], ["transcribe", transcribe], ["memory", memory], ["capabilities", capabilities]] as const) {
    it(`${name} fails closed before account, budget or provider access even for an otherwise eligible account`, async () => {
      mocks.env.MIRA_INFERENCE_DISABLED = "false";
      expect(await authorizeInference(request())).toMatchObject({ mode: "account", id: "owner", memoryConsent: true });
      vi.clearAllMocks(); mocks.env.MIRA_INFERENCE_DISABLED = "true";
      const input = request();
      const response = await route(input);
      if (name !== "capabilities") {
        expect(input.bodyUsed).toBe(true);
        expect(input.body?.locked).toBe(false);
      }
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: "INFERENCE_DISABLED", requestId: expect.any(String) });
      expect(mocks.account).not.toHaveBeenCalled(); expect(mocks.state).not.toHaveBeenCalled(); expect(mocks.get).not.toHaveBeenCalled();
      expect(mocks.capacity).not.toHaveBeenCalled(); expect(mocks.store).not.toHaveBeenCalled(); expect(mocks.provider).not.toHaveBeenCalled();
    });
  }
});
