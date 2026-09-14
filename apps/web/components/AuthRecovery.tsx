"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { BrandMark } from "./BrandMark";

export function AuthRecovery({ mode }: { mode: "forgot" | "reset" | "verify" }) {
  const [token, setToken] = useState(""), [email, setEmail] = useState(""), [password, setPassword] = useState("");
  const [status, setStatus] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [ready,setReady] = useState(false);
  useEffect(() => {
    setReady(true);
    const value = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? new URLSearchParams(window.location.search).get("token");
    if (value) { setToken(value); window.history.replaceState(null, "", window.location.pathname); }
  }, []);
  async function submit() {
    setBusy(true); setError("");
    try {
      const path = mode === "forgot" ? "forgot-password" : mode === "reset" ? "reset-password" : token ? "verify-email" : "request-verification";
      const response = await fetch(`/api/account/${path}`, {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify(mode === "forgot" ? { email } : mode === "reset" ? { token, password } : token ? { token } : {}),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "This request could not be completed.");
      setStatus(mode === "reset" ? "Password updated. Sign in with your new password." : mode === "verify" && token ? "Email verified. You can return to Mira." : "Your request is queued if eligible. Delivery can take a few minutes; provider acceptance does not guarantee inbox delivery.");
      setPassword(""); setToken("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Account email is unavailable."); }
    finally { setBusy(false); }
  }
  const title = mode === "forgot" ? "Reset your password." : mode === "reset" ? "Choose a new password." : "Verify your email.";
  const description = mode === "forgot" ? "Request a short-lived recovery link. We show the same response whether an account exists." : mode === "reset" ? "Use your email link. Changing your password signs out previous sessions." : "Use the link in your email, or sign in to request a new one. Verification links expire after 15 minutes.";
  return <main className="auth-page"><section className="auth-panel">
    <Link href="/"><BrandMark /></Link><h1>{title}</h1><p>{description}</p>
    {!status ? <form method="post" onSubmit={event => { event.preventDefault(); void submit(); }} aria-busy={busy}>
      {mode === "forgot" ? <label className="field">Email<input disabled={!ready || busy} type="email" required maxLength={254} autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></label> : mode === "reset" ? <>
        <label className="field">Reset token<input disabled={!ready || busy} required minLength={32} maxLength={100} autoComplete="off" value={token} onChange={e => setToken(e.target.value)} /></label>
        <label className="field">New password<input disabled={!ready || busy} type="password" required minLength={12} maxLength={200} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
      </> : <label className="field">Verification token (from your email)<input disabled={!ready || busy} maxLength={100} autoComplete="off" value={token} onChange={e => setToken(e.target.value)} /></label>}
      <button className="button button--primary" disabled={busy || !ready}>{busy ? "Please wait…" : mode === "forgot" ? "Request reset link" : mode === "reset" ? "Update password" : token ? "Verify email" : "Request verification link"}</button>
    </form> : null}
    {status ? <p role="status">{status}</p> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}
    <Link href="/login">Back to login</Link><Link href="/support">Contact support</Link>
  </section><aside className="auth-visual" aria-label="Mira’s sunny loft" /></main>;
}
