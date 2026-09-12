"use client";

import { Check, Sparkles } from "lucide-react";
import type { PlanId } from "@companion/config";
import { Modal } from "./Modal";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const betaFeatures = [
  "English and Hinglish chat",
  "Hands-free voice",
  "Avatar calls",
  "Inspectable memory",
  "Activities and shared moments",
];

export function PlanModal({
  onClose,
}: {
  current: PlanId;
  onSelect: (planId: PlanId) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [billing, setBilling] = useState<{
    enabled: boolean;
    environment: string;
    priceLabel: string;
    signedIn: boolean;
    hasSubscription: boolean;
  } | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void fetch("/api/billing/status")
      .then(async (r) => {
        if (r.ok) setBilling(await r.json());
      })
      .catch(() => undefined);
  }, []);
  async function openCheckout() {
    if (!billing?.signedIn) {
      router.push("/login");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await fetch(
        `/api/billing/${billing.hasSubscription ? "portal" : "checkout"}`,
        { method: "POST" },
      );
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      if (typeof body.url !== "string" || !body.url.startsWith("https://"))
        throw new Error("Checkout did not return a secure URL.");
      window.location.assign(body.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout unavailable");
      setBusy(false);
    }
  }
  if (billing?.enabled)
    return (
      <Modal
        title="Mira membership"
        description={
          billing.environment === "test_mode"
            ? "TEST checkout only. No real charges. Use test payment details only."
            : "Optional membership. Review the price and recurring terms on secure checkout before paying."
        }
        onClose={onClose}
      >
        <p>{billing.priceLabel}</p>
        <p>
          Export, account deletion and safety controls remain free. Checkout
          redirects do not activate access; verified payment events do.
        </p>
        <button
          className="button button--primary"
          disabled={busy}
          onClick={() => void openCheckout()}
        >
          {busy
            ? "Opening…"
            : billing.hasSubscription
              ? "Manage subscription"
              : billing.signedIn
                ? "Review secure checkout"
                : "Sign in to continue"}
        </button>
        {error ? <p role="alert">{error}</p> : null}
      </Modal>
    );
  return (
    <Modal
      title="Free public beta"
      description="Mira does not ask for payment details during this beta."
      onClose={onClose}
    >
      <div className="plan-grid">
        <article className="plan-card plan-card--current">
          <Sparkles aria-hidden="true" />
          <span>Available now</span>
          <h3>₹0</h3>
          <ul>
            {betaFeatures.map((feature) => (
              <li key={feature}>
                <Check aria-hidden="true" /> {feature}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="button button--primary"
            onClick={onClose}
          >
            Continue with Mira
          </button>
        </article>
      </div>
      <p className="settings-note">
        Beta availability and provider capacity can change. Safety rules, memory
        controls, export, and account deletion remain available to every user.
      </p>
    </Modal>
  );
}
