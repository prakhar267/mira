import { AccountError, sha256 } from "./account-server";
import { storeAction } from "./cloud-store";
import { emailConfigured } from "./mail-outbox";
import type { MailJob, MailPurpose } from "./mail-outbox-engine";
import type { LaunchEnvironment } from "./launch-readiness";

export async function requestAccountMail(email: string, purpose: MailPurpose, env: LaunchEnvironment) {
  if (!emailConfigured(env)) throw new AccountError("Email delivery is not configured yet. No email has been sent; please contact support.", 503);
  const now = Date.now();
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
  // Same queue behavior for existing and absent accounts; no lookup or send in
  // the request path. Duplicate requests in the same window do not renew TTL.
  const job: MailJob = { id: await sha256(`${purpose}:${email}:${Math.floor(now / 300_000)}`), email, purpose, token, tokenHash: await sha256(token), createdAt: now, expiresAt: now + 900_000, attempts: 0 };
  await storeAction({ action: "mailEnqueue", job });
  return { accepted: true, message: "If eligible, your request has been queued. Provider acceptance and mailbox delivery are separate steps." };
}
