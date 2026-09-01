import { describe, expect, it } from "vitest";
import { initialState } from "./state";
import { canAccessItem, currencyBalance } from "./product-rules";

describe("local product rules", () => {
  it("ships all acceptance seed content", () => {
    expect(initialState.activities.length).toBeGreaterThanOrEqual(14);
    expect(initialState.storeItems.length).toBeGreaterThanOrEqual(6);
    expect(initialState.memoryEnabled).toBe(true);
  });

  it("gates store items by inherited plan order", () => {
    const premium = initialState.storeItems.find((item) => item.tierRequired === "ultra");
    expect(premium).toBeDefined();
    expect(canAccessItem("plus", premium!)).toBe(false);
    expect(canAccessItem("platinum", premium!)).toBe(true);
    expect(currencyBalance(premium!, initialState.wallet)).toBe(initialState.wallet.gems);
  });
});
