import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ action: vi.fn() }));
vi.mock("./cloud-store", () => ({ storeAction: mocks.action }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: { CHAT_DAILY_LIMIT: "600", SPEECH_DAILY_LIMIT: "600", TRANSCRIBE_DAILY_LIMIT: "600" } }));
import { withInferenceCapacity } from "./capacity";
const principal = { mode: "demo" as const, id: "synthetic", memoryConsent: true };
describe("provider reservation accounting", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.action.mockResolvedValue({ allowed: true }); });
  it("keeps account headroom and charges cost before work, releasing only concurrency", async () => {
    const work = vi.fn(async () => "reply");
    await expect(withInferenceCapacity("chat", principal, 1500, work)).resolves.toBe("reply");
    expect(mocks.action.mock.calls[0]?.[0]).toMatchObject({ action: "inferenceReserve", demoMax: 240, units: 1500, personalMax: 40 });
    expect(mocks.action.mock.calls[1]?.[0]).toMatchObject({ action: "inferenceRelease" });
    expect(work).toHaveBeenCalledOnce();
  });
  it("does not execute providers after capacity denial and forwards actual retry timing", async () => {
    mocks.action.mockResolvedValue({ allowed: false, reason: "daily", retryAfter: 12000 });
    const work = vi.fn();
    await expect(withInferenceCapacity("memory", principal, 50, work)).rejects.toMatchObject({ code: "DAILY_CAPACITY_EXHAUSTED", retryAfterSeconds: 12000 });
    expect(work).not.toHaveBeenCalled();
  });
  it("charges failed attempts and holds canceled leases until their short expiry", async () => {
    await expect(withInferenceCapacity("speech", principal, 20, async () => { throw new Error("provider failure"); })).rejects.toThrow("failure");
    expect(mocks.action).toHaveBeenCalledTimes(2);
    mocks.action.mockClear();
    await expect(withInferenceCapacity("chat", principal, 20, async () => { throw new DOMException("Canceled", "AbortError"); })).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.action).toHaveBeenCalledTimes(1);
  });
});
