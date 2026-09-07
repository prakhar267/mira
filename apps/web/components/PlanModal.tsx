"use client";

import { Check, Sparkles } from "lucide-react";
import type { PlanId } from "@companion/config";
import { Modal } from "./Modal";

const betaFeatures = ["English and Hinglish chat", "Hands-free voice", "Avatar calls", "Inspectable memory", "Activities and shared moments"];

export function PlanModal({ onClose }: { current: PlanId; onSelect: (planId: PlanId) => void; onClose: () => void }) {
  return <Modal title="Free public beta" description="Mira does not ask for payment details during this beta." onClose={onClose}><div className="plan-grid"><article className="plan-card plan-card--current"><Sparkles aria-hidden="true" /><span>Available now</span><h3>₹0</h3><ul>{betaFeatures.map((feature) => <li key={feature}><Check aria-hidden="true" /> {feature}</li>)}</ul><button type="button" className="button button--primary" onClick={onClose}>Continue with Mira</button></article></div><p className="settings-note">Beta availability and provider capacity can change. Safety rules, memory controls, export, and account deletion remain available to every user.</p></Modal>;
}
