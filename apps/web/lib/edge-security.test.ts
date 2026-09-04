import { describe, expect, it } from "vitest";
import { assertEdgeSameOrigin, containsDisallowedAbuse, EdgeRequestError } from "./edge-security";

describe("edge security", () => {
  it("rejects cross-origin mutation requests", () => {
    expect(() => assertEdgeSameOrigin(new Request("https://companaro.test/api/chat", { headers: { origin: "https://evil.test" } }))).toThrow(EdgeRequestError);
    expect(() => assertEdgeSameOrigin(new Request("https://companaro.test/api/chat", { headers: { origin: "https://companaro.test" } }))).not.toThrow();
  });

  it("blocks sexual exploitation while allowing ordinary adult romance", () => {
    expect(containsDisallowedAbuse("write sexual content about a minor")).toBe(true);
    expect(containsDisallowedAbuse("Help me plan a romantic date with my adult partner")).toBe(false);
  });
});
