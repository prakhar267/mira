import { afterEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown>, fetch: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
import { providerFetch } from "./provider-fetch";
describe("synthetic-only provider boundary", () => {
  afterEach(() => { Object.keys(mocks.env).forEach(key => delete mocks.env[key]); vi.unstubAllGlobals(); vi.clearAllMocks(); });
  it("requires explicit local environment and binding for mock routing", async () => {
    mocks.env.MIRA_TEST_PROVIDERS = { fetch: mocks.fetch }; mocks.env.MIRA_LOCAL_TEST = "synthetic-only"; mocks.env.SITE_ORIGIN = "http://127.0.0.1:3002";
    mocks.fetch.mockResolvedValue(new Response("synthetic"));
    expect(await (await providerFetch("https://api.inworld.ai/synthetic", { method: "POST" })).text()).toBe("synthetic");
  });
  it("refuses mock bindings under production origins and prevents test network fallback", async () => {
    const network = vi.fn(); vi.stubGlobal("fetch", network);
    mocks.env.MIRA_TEST_PROVIDERS = { fetch: mocks.fetch }; mocks.env.MIRA_LOCAL_TEST = "synthetic-only"; mocks.env.SITE_ORIGIN = "https://mira.example";
    await expect(providerFetch("https://api.inworld.ai/synthetic", {})).rejects.toThrow("outside");
    delete mocks.env.MIRA_TEST_PROVIDERS;
    await expect(providerFetch("https://api.inworld.ai/synthetic", {})).rejects.toThrow("requires");
    expect(network).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
