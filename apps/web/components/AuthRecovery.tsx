"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { BrandMark } from "./BrandMark";
export function AuthRecovery({mode}:{mode:"forgot"|"reset"|"verify"}) {
  const [token,setToken] = useState(""), [email,setEmail] = useState(""), [password,setPassword] = useState("");
  const [status,setStatus] = useState(""), [error,setError] = useState(""), [busy,setBusy] = useState(false);
  useEffect(()=>{
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const value = hash.get("token") ?? new URLSearchParams(window.location.search).get("token");
    if(value) { setToken(value); window.history.replaceState(null,"",window.location.pathname); }
  },[]);
  return <main className="auth-page"><section className="auth-panel"><Link href="/"><BrandMark/></Link><h1>{mode==="forgot" ? "Reset your password." : mode==="reset" ? "Choose a new password." : "Email verification"}</h1><p>{mode==="forgot" ? "We’ll email a short-lived recovery link if your account exists." : mode==="reset" ? "Use your email link. Changing your password signs out previous sessions." : "Email verification is not available during this beta. Contact support if you need help."}</p>{mode!=="verify" && !status ? <form onSubmit={async(event)=>{event.preventDefault();setBusy(true);setError("");try {const response=await fetch(`/api/account/${mode==="forgot" ? "forgot-password" : "reset-password"}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(mode==="forgot" ? {email} : {token,password})});const body=await response.json();if(!response.ok)throw new Error(body.error ?? "Recovery failed.");setStatus(mode==="forgot" ? "If an account exists, a reset link has been requested. Check your inbox and spam folder." : "Password updated. Sign in with your new password.");} catch(cause) {setError(cause instanceof Error ? cause.message : "Recovery unavailable.");} finally {setBusy(false);}}}>
      {mode==="forgot" ? <label className="field">Email<input type="email" required autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}/></label> : <><label className="field">Reset token<input required minLength={32} value={token} onChange={e=>setToken(e.target.value)}/></label><label className="field">New password<input type="password" required minLength={12} maxLength={200} autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/></label></>}
      <button className="button button--primary" disabled={busy}>{busy ? "Please wait…" : mode==="forgot" ? "Send reset link" : "Update password"}</button></form> : null}
      {status ? <p role="status">{status}</p>:null}{error ? <p className="form-error" role="alert">{error}</p>:null}<Link href="/login">Back to login</Link><Link href="/support">Contact support</Link></section><aside className="auth-visual" aria-label="Mira’s sunny loft"/></main>;
}
