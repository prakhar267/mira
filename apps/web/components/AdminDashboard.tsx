"use client";

import { useState } from "react";
import Link from "next/link";
import { Activity, ArrowLeft, Bot, CheckCircle2, Gauge, KeyRound, ShieldCheck, ToggleLeft } from "lucide-react";
import { BrandMark } from "./BrandMark";
import { companionApi } from "@/lib/api-client";

const initialFlags = { voice: true, camera: true, imageGeneration: true, romanticMode: true, proactiveMessaging: true, advancedMemory: true, store: true, journal: true };

export function AdminDashboard() {
  const [key, setKey] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [flags, setFlags] = useState(initialFlags);
  const [metricsData, setMetricsData] = useState({ requests: 0, successfulRequests: 0, averageLatencyMs: 0, estimatedCostUsd: 0 });
  const [providers, setProviders] = useState<Record<string, string | boolean>>({});
  const [error, setError] = useState("");
  if (!authorized) return <main className="admin-page"><section className="admin-login"><BrandMark /><KeyRound aria-hidden="true" /><span className="eyebrow">Operations console</span><h1>Private, aggregate controls.</h1><p>Admin surfaces never expose private conversation content.</p><form onSubmit={(event) => { event.preventDefault(); setError(""); void Promise.all([companionApi.adminMetrics(key), companionApi.adminProviders(key), companionApi.adminFlags(key)]).then(([metrics, providerState, flagState]) => { setMetricsData(metrics); setProviders(providerState); setFlags(flagState as typeof initialFlags); setAuthorized(true); }).catch(() => setError("The admin key was rejected or the API is unavailable.")); }}><label className="field">Admin API key<input type="password" value={key} onChange={(event) => setKey(event.target.value)} required /></label>{error ? <p className="form-error" role="alert">{error}</p> : null}<button type="submit" className="button button--primary">Open console</button></form><Link href="/"><ArrowLeft aria-hidden="true" /> Back to Companion</Link></section></main>;
  const successRate = metricsData.requests ? Math.round((metricsData.successfulRequests / metricsData.requests) * 100) : 100;
  const metrics = [{ label: "Provider requests", value: String(metricsData.requests), detail: `${successRate}% successful`, icon: Activity }, { label: "Average latency", value: `${metricsData.averageLatencyMs} ms`, detail: String(providers.chat ?? "provider"), icon: Gauge }, { label: "Estimated cost", value: `$${metricsData.estimatedCostUsd.toFixed(4)}`, detail: "aggregate only", icon: Bot }, { label: "Safety mode", value: String(providers.moderation ?? "local"), detail: "input + output checks", icon: ShieldCheck }];
  return <main className="admin-page"><header className="admin-header"><BrandMark /><div><span><CheckCircle2 aria-hidden="true" /> Admin authenticated</span><Link href="/app?preview=home">Open product</Link></div></header><section className="admin-content"><div className="section-intro"><span className="eyebrow">Privacy-safe operations</span><h1>System health, without private conversations.</h1><p>Aggregate usage, provider state, flags, and safety outcomes from the connected runtime.</p></div><div className="admin-metrics">{metrics.map(({ label, value, detail, icon: Icon }) => <article key={label}><Icon aria-hidden="true" /><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>)}</div><div className="admin-panels"><section><div className="settings-section__heading"><ToggleLeft aria-hidden="true" /><div><h2>Feature flags</h2><p>Updates are enforced by the API process.</p></div></div>{Object.entries(flags).map(([name, enabled]) => <label className="toggle-line" key={name}><span><strong>{name.replace(/([A-Z])/g, " $1")}</strong><small>{enabled ? "Available" : "Paused"}</small></span><input type="checkbox" checked={enabled} onChange={(event) => { const next = { ...flags, [name]: event.target.checked }; setFlags(next); void companionApi.updateAdminFlags(key, next); }} /></label>)}</section><section><div className="settings-section__heading"><Bot aria-hidden="true" /><div><h2>Provider status</h2><p>Adapters keep credentials server-side.</p></div></div>{Object.entries(providers).map(([name, provider]) => <div key={name} className="provider-row"><i /><span>{name} · {String(provider)}</span><strong>healthy</strong></div>)}</section></div></section></main>;
}
