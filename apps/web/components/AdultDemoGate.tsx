"use client";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
const key = "mira-adult-declaration-v1";
export function AdultDemoGate({ children }: { children: ReactNode }) {
  const [accepted, setAccepted] = useState(false),
    [checked, setChecked] = useState(false),
    [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      setAccepted(localStorage.getItem(key) === "yes");
    } catch {}
    setReady(true);
  }, []);
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
        <button
          className="button button--primary"
          disabled={!checked}
          onClick={() => {
            try {
              localStorage.setItem(key, "yes");
            } catch {}
            setAccepted(true);
          }}
        >
          Meet Mira
        </button>
        <Link href="/">Go back</Link>
        <small>
          This is an age declaration, not independently verified age assurance.
        </small>
      </section>
    </main>
  );
}
