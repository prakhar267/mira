"use client";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { createDemoSession, fetchCapabilities, type CapabilityContract } from "@/lib/runtime-capabilities";
export function AdultDemoGate({ children, onConsent, onAccess }: { children: ReactNode; onConsent?: (memoryConsent: boolean) => void; onAccess?: (access: CapabilityContract) => void }) {
  const [accepted, setAccepted] = useState(false),
    [checked, setChecked] = useState(false),
    [processing, setProcessing] = useState(false),
    [memory, setMemory] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [ready, setReady] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    void fetchCapabilities(abort.signal).then(result => {
      if (!abort.signal.aborted) { onAccess?.(result); setAccepted(result.mode === "demo" && result.capabilities.chat); }
    }).catch(() => undefined).finally(() => { if (!abort.signal.aborted) setReady(true); });
    return () => abort.abort();
  }, [onAccess]);
  if (!ready) return <div className="app-loader">Opening Mira…</div>;
  if (accepted) return children;
  return (
    <main className="auth-page">
      <section className="auth-panel">
        <span className="eyebrow">Before we meet</span>
        <h1>A little space for conversation.</h1>
        <p>
          Mira is an AI companion for adults 18+, not a real person, therapist
          or emergency service. Voice and messages you send are processed by
          external AI providers. Camera preview stays on your device; frame
          understanding is not available in this beta.
        </p>
        <p>
          Demo history stays in this browser. You can inspect memories, export
          or reset it anytime.
        </p>
        <label className="toggle-line">
          <span>
            I confirm I am 18 or older and agree to the{" "}
            <a href="/terms" target="_blank" rel="noreferrer">
              Terms
            </a>{" "}
            and{" "}
            <a href="/privacy" target="_blank" rel="noreferrer">
              Privacy Policy
            </a>
            .
          </span>
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          />
        </label>
        <label className="toggle-line"><span>I consent to sending my messages and voice input to the disclosed AI providers. I can pause this in Privacy settings.</span><input type="checkbox" checked={processing} onChange={event => setProcessing(event.target.checked)} /></label>
        <label className="toggle-line"><span>Also enable inspectable memory for continuity (optional). I can correct, pause or forget it.</span><input type="checkbox" checked={memory} onChange={event => setMemory(event.target.checked)} /></label>
        {error ? <p role="alert" className="form-error">{error}</p> : null}
        <button
          className="button button--primary"
          disabled={!checked || !processing || busy}
          onClick={() => {
            setBusy(true); setError("");
            void createDemoSession(memory).then(access => { onAccess?.(access); onConsent?.(memory); setAccepted(true); }).catch(cause => setError(cause instanceof Error ? cause.message : "The demo could not start.")).finally(() => setBusy(false));
          }}
        >
          {busy ? "Starting demo…" : "Meet Mira"}
        </button>
        <Link href="/">Go back</Link>
        <small>
          This is an age declaration, not independently verified age assurance.
        </small>
      </section>
    </main>
  );
}
