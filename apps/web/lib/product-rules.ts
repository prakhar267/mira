import type { StoreItemRecord, SubscriptionPlanId } from "@companion/shared";

const planOrder: SubscriptionPlanId[] = ["free", "plus", "ultra", "platinum"];

export function canAccessItem(planId: SubscriptionPlanId, item: StoreItemRecord): boolean {
  return planOrder.indexOf(planId) >= planOrder.indexOf(item.tierRequired);
}

export function currencyBalance(item: StoreItemRecord, wallet: { coins: number; gems: number }): number {
  return item.currency === "free" ? Number.POSITIVE_INFINITY : wallet[item.currency];
}
