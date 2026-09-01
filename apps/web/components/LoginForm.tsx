"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { companionApi } from "@/lib/api-client";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  return <form onSubmit={(event) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    void (companionApi.enabled ? companionApi.login(email, password) : Promise.resolve()).then(() => router.push(companionApi.enabled ? "/app" : "/demo")).catch((cause) => setError(cause instanceof Error ? cause.message : "Sign-in failed.")).finally(() => setLoading(false));
  }}>
    <label className="field">Email<input name="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
    <label className="field">Password<input name="password" type="password" autoComplete="current-password" minLength={12} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 12 characters" /></label>
    <Link className="forgot-link" href="/forgot-password">Forgot password?</Link>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <button className="button button--primary" type="submit" disabled={loading}>{loading ? "Signing in…" : "Log in"} <ArrowRight aria-hidden="true" /></button>
    <small><ShieldCheck aria-hidden="true" /> Passwords are hashed server-side and session tokens rotate.</small>
  </form>;
}
