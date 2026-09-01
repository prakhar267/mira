import { plans, type Entitlement, type PlanId } from "./features";

const planOrder: PlanId[] = ["free", "plus", "ultra", "platinum"];

export class FeatureEntitlementService {
  featuresFor(planId: PlanId): Set<Entitlement> {
    const tier = planOrder.indexOf(planId);
    return new Set(planOrder.slice(0, tier + 1).flatMap((id) => plans[id].features) as Entitlement[]);
  }

  has(planId: PlanId, entitlement: Entitlement): boolean {
    return this.featuresFor(planId).has(entitlement);
  }

  minimumPlan(entitlement: Entitlement): PlanId {
    return planOrder.find((planId) => this.has(planId, entitlement)) ?? "platinum";
  }
}

export const featureEntitlements = new FeatureEntitlementService();
