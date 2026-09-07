"use client";

import { useState, type FormEvent } from "react";
import { CheckCircle2, Send } from "lucide-react";

export function SupportForm() {
  const [submitting, setSubmitting] = useState(false);
  const [ticketId, setTicketId] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/support", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          summary: form.get("summary"),
          details: form.get("details"),
          email: form.get("email"),
          page: form.get("page"),
        }),
      });
      const result = await response.json() as { ticketId?: string; error?: string };
      if (!response.ok || !result.ticketId) throw new Error(result.error || "Your report could not be submitted.");
      setTicketId(result.ticketId);
      event.currentTarget.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your report could not be submitted.");
    } finally {
      setSubmitting(false);
    }
  }

  if (ticketId) return <div className="support-success" role="status"><CheckCircle2 aria-hidden="true" /><div><strong>Report received</strong><p>Save ticket ID <code>{ticketId}</code>. Thank you for helping improve Mira.</p></div></div>;

  return <form className="support-form" onSubmit={submit}>
    <label>Short summary<input name="summary" required minLength={5} maxLength={140} autoComplete="off" placeholder="Voice stopped after my first reply" /></label>
    <label>What happened?<textarea name="details" required minLength={10} maxLength={3000} placeholder="Tell us what you expected, what happened, and the steps to reproduce it." /></label>
    <div className="support-form__row"><label>Page or feature<input name="page" maxLength={120} placeholder="Voice call" /></label><label>Email for a reply (optional)<input name="email" type="email" maxLength={254} autoComplete="email" placeholder="you@example.com" /></label></div>
    <small>Do not send passwords, tokens, private conversations, or sensitive personal information. Reports are retained for up to 90 days.</small>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <button className="button button--primary" type="submit" disabled={submitting}><Send aria-hidden="true" /> {submitting ? "Sending…" : "Submit report"}</button>
  </form>;
}
