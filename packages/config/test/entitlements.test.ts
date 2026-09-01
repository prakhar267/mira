import { describe, expect, it } from "vitest";
import { FeatureEntitlementService } from "../src/entitlements";

describe("FeatureEntitlementService", () => {
  const service = new FeatureEntitlementService();

  it("inherits lower-tier capabilities", () => {
    expect(service.has("plus", "textChat")).toBe(true);
    expect(service.has("plus", "voiceConversations")).toBe(true);
    expect(service.has("plus", "voiceCalls")).toBe(false);
    expect(service.has("ultra", "voiceCalls")).toBe(true);
    expect(service.has("plus", "advancedMemory")).toBe(false);
  });

  it("returns the first plan that unlocks a feature", () => {
    expect(service.minimumPlan("responseExplanation")).toBe("platinum");
    expect(service.minimumPlan("manualMemory")).toBe("ultra");
  });
});
