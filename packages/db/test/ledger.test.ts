import { describe, expect, it } from "vitest";
import type { StoreItemRecord } from "@companion/shared";
import { WalletLedger } from "../src/ledger";

const item: StoreItemRecord = { id: "linen-jacket", name: "Linen jacket", description: "A soft neutral layer.", category: "Clothing", assetUrl: "/assets/noor-portrait.png", currency: "coins", price: 120, tierRequired: "free", metadata: {}, active: true };

describe("WalletLedger", () => {
  it("makes purchases idempotent and immutable", () => {
    const ledger = new WalletLedger("user-1", { xp: 0, level: 1, coins: 240, gems: 0 });
    ledger.purchase(item, "purchase-0001");
    ledger.purchase(item, "purchase-0001");
    expect(ledger.snapshot().coins).toBe(120);
    expect(ledger.history()).toHaveLength(1);
  });

  it("rejects overspending and allows one refund", () => {
    const ledger = new WalletLedger("user-1", { xp: 0, level: 1, coins: 100, gems: 0 });
    expect(() => ledger.purchase(item, "purchase-0002")).toThrow("Insufficient balance");
    const funded = new WalletLedger("user-1", { xp: 0, level: 1, coins: 240, gems: 0 });
    funded.purchase(item, "purchase-0003");
    const purchase = funded.history()[0];
    expect(purchase).toBeDefined();
    funded.refund(purchase!.id, "refund-0003");
    expect(funded.snapshot().coins).toBe(240);
  });
});
