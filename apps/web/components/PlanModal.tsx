"use client";

import { Check, Crown, Sparkles, Zap } from "lucide-react";
import { plans, type PlanId } from "@companion/config";
import { Modal } from "./Modal";

const prices: Record<PlanId, string> = { free: "₹0", plus: "₹499", ultra: "₹999", platinum: "₹1,999" };
const icons = { free: Sparkles, plus: Zap, ultra: Crown, platinum: Crown } as const;

export function PlanModal({ current, onSelect, onClose }: { current: PlanId; onSelect: (planId: PlanId) => void; onClose: () => void }) {
  return <Modal title="Choose the experience that fits" description="Test mode changes entitlements instantly and never charges a real payment method." onClose={onClose}><div className="plan-grid">{(Object.keys(plans) as PlanId[]).map((planId) => { const plan = plans[planId]; const Icon = icons[planId]; return <article key={planId} className={planId === current ? "plan-card plan-card--current" : "plan-card"}><Icon aria-hidden="true" /><span>{plan.name}</span><h3>{prices[planId]}<small>/month</small></h3><ul>{plan.features.map((feature) => <li key={feature}><Check aria-hidden="true" /> {feature.replace(/([A-Z])/g, " $1").toLowerCase()}</li>)}</ul><button type="button" className={planId === "platinum" ? "button button--primary" : "button button--ghost"} disabled={planId === current} onClick={() => onSelect(planId)}>{planId === current ? "Current plan" : planId === "free" ? "Switch to Free" : `Choose ${plan.name}`}</button></article>; })}</div><p className="settings-note">Subscriptions do not alter safety rules, memory controls, or your ability to export and delete data.</p></Modal>;
}
