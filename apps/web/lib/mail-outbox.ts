import type { MailJob } from "./mail-outbox-engine";
import type { LaunchEnvironment } from "./launch-readiness";

export interface MailOutboxAdapter {
  get(key: string): Promise<string | null>;
  prepareToken(job: MailJob, userId: string): Promise<boolean>;
  claim(): Promise<MailJob[]>;
  pending(id: string): Promise<boolean>;
  complete(id: string, status: "accepted" | "discarded" | "retry"): Promise<void>;
  metric(failed: boolean, duration: number): Promise<void>;
}

export function emailConfigured(env: LaunchEnvironment) {
  if (!env.RESEND_API_KEY?.trim() || !env.EMAIL_FROM?.trim()) return false;
  try { const origin = new URL(env.SITE_ORIGIN ?? ""); return origin.protocol === "https:" && !origin.username && !origin.password && origin.pathname === "/"; } catch { return false; }
}

async function hash(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Called by a Durable Object alarm. Uses idempotent provider acceptance, not a
 * claim of mailbox delivery. Never logs addresses, tokens or provider bodies. */
export async function runMailOutbox(env: LaunchEnvironment, store: MailOutboxAdapter, send: typeof fetch = fetch) {
  if (!emailConfigured(env)) return { configured: false, accepted: 0, failed: 0 };
  let accepted = 0, failed = 0;
  for (let processed=0;processed<5;processed++) {
    const job=(await store.claim())[0];
    if(!job)break;
    const start = Date.now();
    try {
      const userId = await store.get(`email:${await hash(job.email)}`);
      const accountRaw = userId ? await store.get(`account:${userId}`) : null;
      const account = accountRaw ? JSON.parse(accountRaw) as { email?: string; emailVerifiedAt?: string; passwordChangedAt?: string } : null;
      if (!userId || !account || account.email !== job.email || job.expiresAt <= Date.now() || (job.purpose === "verification" && account.emailVerifiedAt) || (job.purpose === "recovery" && account.passwordChangedAt && job.createdAt <= Date.parse(account.passwordChangedAt))) {
        await store.complete(job.id, "discarded");
        continue;
      }
      // Refuse consumed token tombstones: a delivery retry after successful use
      // must never recreate a password-reset capability.
      if (!await store.prepareToken(job, userId)) { await store.complete(job.id, "discarded"); continue; }
      if (!await store.pending(job.id) || !await store.get(`account:${userId}`)) continue;
      const url = new URL(job.purpose === "recovery" ? "/reset-password" : "/verify-email", env.SITE_ORIGIN);
      url.hash = `token=${job.token}`;
      const response = await send("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json", "idempotency-key": `mira-${job.purpose}-${job.id}` },
        body: JSON.stringify({ from: env.EMAIL_FROM, to: [job.email], subject: job.purpose === "recovery" ? "Reset your Mira password" : "Verify your Mira email", text: `You requested a Mira ${job.purpose === "recovery" ? "password reset" : "email verification"}. This link expires 15 minutes after the request and can be used once.\n\n${url}\n\nIf this wasn't you, ignore this email.` }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status >= 400 && response.status < 500 && response.status !== 429 && response.status !== 408) {
          await store.complete(job.id, "discarded");
        } else await store.complete(job.id, "retry");
        failed++;
        await store.metric(true, Date.now() - start);
        continue;
      }
      await response.body?.cancel();
      await store.complete(job.id, "accepted");
      accepted++;
      await store.metric(false, Date.now() - start);
    } catch {
      failed++;
      await store.complete(job.id, "retry").catch(() => undefined);
      await store.metric(true, Date.now() - start).catch(() => undefined);
    }
  }
  return { configured: true, accepted, failed };
}
