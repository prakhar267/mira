"use client";
import Link from "next/link";
import { useState } from "react";
type Ticket = {
  ticketId: string;
  summary: string;
  details: string;
  email: string | null;
  status: string;
  createdAt: string;
};
type Snapshot = {
  tickets: Ticket[];
  metrics: Record<string, unknown>[];
  alerts: string[];
  nextCursor?: string;
  configuration: Record<string, unknown>;
  readiness: Record<string, unknown>;
  monitor: Record<string, unknown> | null;
  recentMetrics: Record<string, unknown>[];
  storageStats: Record<string, unknown>;
  mailOutbox: Record<string, unknown>;
};
export function OperationsDashboard() {
  const [key, setKey] = useState(""),
    [data, setData] = useState<Snapshot | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load(cursor?: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(
        `/api/admin/operations${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
        { headers: { authorization: `Bearer ${key}` }, cache: "no-store" },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unavailable");
    } finally {
      setBusy(false);
    }
  }
  async function update(ticketId: string, status: string) {
    try {
      const res = await fetch("/api/admin/operations", {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ticketId, status }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  }
  return (
    <main className="workspace operations-page">
      <header className="workspace-header">
        <h1>Mira operations</h1>
        <Link href="/">Website</Link>
      </header>
      <p>
        Private operator inbox and aggregate service health. The access key
        stays in memory only; never share it in chat or a URL.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <label className="field">
          Operator access key
          <input
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            required
          />
        </label>
        <button className="button button--primary" disabled={busy}>
          {busy ? "Loading…" : "Open dashboard / Refresh"}
        </button>
        <button
          type="button"
          className="button button--ghost"
          onClick={() => {
            setKey("");
            setData(null);
          }}
        >
          Lock
        </button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      {data ? (
        <>
          <section className="settings-section">
            <h2>Service alerts</h2>
            {data.alerts.length ? (
              data.alerts.map((a) => (
                <p role="alert" key={a}>
                  {a}
                </p>
              ))
            ) : (
              <p>
                No threshold alerts in recorded traffic. This is not proof that
                all providers are available.
              </p>
            )}
            <p>
              Rolling 15-minute alerts: above 5% failed/limited requests
              (at least 10 requests) or approximate P95 above 5 seconds
              (at least 20). Cloudflare checks every 15 minutes; external
              delivery still requires an approved alert channel.
            </p>
            <pre>{JSON.stringify(data.configuration, null, 2)}</pre>
            <details><summary>Storage and cleanup backlog (logical, not billed usage)</summary><pre>{JSON.stringify(data.storageStats, null, 2)}</pre></details>
            <details><summary>Mail queue (provider acceptance is not mailbox delivery)</summary><pre>{JSON.stringify(data.mailOutbox, null, 2)}</pre></details>
            <details><summary>Last scheduled check</summary><pre>{JSON.stringify(data.monitor, null, 2)}</pre></details>
            <details><summary>Recent stage latency buckets (P50/P95/P99 upper bounds, not exact percentiles)</summary><pre>{JSON.stringify(data.recentMetrics, null, 2)}</pre></details>
          </section>
          <section className="settings-section">
            <h2>Launch readiness</h2>
            <p>Configured is not the same as tested or legally approved. No credentials are displayed.</p>
            <pre>{JSON.stringify(data.readiness, null, 2)}</pre>
          </section>
          <section className="settings-section">
            <h2>Support inbox</h2>
            {data.tickets.length ? (
              data.tickets.map((t) => (
                <article className="settings-section" key={t.ticketId}>
                  <h3>{t.summary}</h3>
                  <small>
                    {t.ticketId} · {t.createdAt}
                  </small>
                  <p style={{ whiteSpace: "pre-wrap" }}>{t.details}</p>
                  {t.email ? (
                    <a
                      href={`mailto:${encodeURIComponent(t.email)}?subject=${encodeURIComponent(`Re: ${t.ticketId} ${t.summary}`)}`}
                    >
                      Reply by email
                    </a>
                  ) : (
                    <p>No reply address supplied.</p>
                  )}
                  <label className="field">
                    Status
                    <select
                      value={t.status}
                      onChange={(e) => void update(t.ticketId, e.target.value)}
                    >
                      <option value="new">New</option>
                      <option value="investigating">Investigating</option>
                      <option value="resolved">Resolved</option>
                    </select>
                  </label>
                </article>
              ))
            ) : (
              <p>No tickets on this page.</p>
            )}
            {data.nextCursor ? (
              <button
                className="button button--ghost"
                onClick={() => void load(data.nextCursor)}
              >
                Next page
              </button>
            ) : null}
          </section>
          <section className="settings-section">
            <h2>Last seven days</h2>
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Day</th>
                    <th>Event</th>
                    <th>Requests</th>
                    <th>Failed/limited</th>
                    <th>Average ms</th>
                  </tr>
                </thead>
                <tbody>
                  {data.metrics.map((r) => (
                    <tr key={`${r.day}:${r.name}`}>
                      {[
                        "day",
                        "name",
                        "total",
                        "failures",
                        "averageLatencyMs",
                      ].map((k) => (
                        <td key={k}>{String(r[k])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}
