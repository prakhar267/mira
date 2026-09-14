import { describe, it, expect, vi } from "vitest";
vi.mock("next/server", () => ({ after: vi.fn() }));
import { readEdgeJson, EdgeRequestError, edgeError, assertEdgeSameOrigin, containsDisallowedAbuse } from "./edge-security";
describe("existing edge security regressions", () => {
  it("rejects cross-origin mutation requests", () => {
    expect(() => assertEdgeSameOrigin(new Request("https://companaro.test/api/chat", { headers: { origin: "https://evil.test" } }))).toThrow(EdgeRequestError);
    expect(() => assertEdgeSameOrigin(new Request("https://companaro.test/api/chat", { headers: { origin: "https://companaro.test" } }))).not.toThrow();
  });
  it("blocks sexual exploitation while allowing ordinary adult romance", () => {
    expect(containsDisallowedAbuse("write sexual content about a minor")).toBe(true);
    expect(containsDisallowedAbuse("Help me plan a romantic date with my adult partner")).toBe(false);
  });
});
describe("bounded streaming request reader", () => {
  it("cancels streams at the byte limit even with missing or false Content-Length", async () => {
    for (const headers of [{}, { "content-length": "1" }]) {
      let canceled = false, reads = 0;
      const body = new ReadableStream({ pull(controller) { reads++; controller.enqueue(new TextEncoder().encode('"' + "a".repeat(40))); }, cancel() { canceled = true; } });
      const request = new Request("https://mira.test", { method: "POST", body, headers, duplex: "half" } as RequestInit);
      await expect(readEdgeJson(request, 100)).rejects.toMatchObject({ status: 413 });
      expect(canceled).toBe(true); expect(reads).toBeLessThan(6);
    }
  });
  it("handles split UTF8 safely and rejects deep JSON", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ message: "हिंदी" }));
    const stream = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
    const request = new Request("https://mira.test", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    expect(await readEdgeJson(request, 100)).toEqual({ message: "हिंदी" });
    await expect(readEdgeJson(new Request("https://mira.test", { method: "POST", body: "[".repeat(20) + "0" + "]".repeat(20) }), 100)).rejects.toThrow("nested");
  });
  it("returns stable error codes/request IDs and accurate daily retry metadata", async () => {
    const response = await edgeError("synthetic-request", "test", Date.now(), new EdgeRequestError("Daily limit", 429, "DAILY_CAPACITY_EXHAUSTED", 10000));
    expect(response.headers.get("retry-after")).toBe("10000");
    expect(await response.json()).toMatchObject({ code: "DAILY_CAPACITY_EXHAUSTED", requestId: "synthetic-request", retryAfterSeconds: 10000 });
  });
});
