import { buildPushPayload, type VapidKeys } from "@block65/webcrypto-web-push";
import type { ReminderEngine } from "./reminder-engine";
export const pushBase64 = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
export async function createPushKeys(subject: string): Promise<VapidKeys> {
  const key = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const privateKey = await crypto.subtle.exportKey("jwk", key.privateKey);
  const publicKey = await crypto.subtle.exportKey("raw", key.publicKey);
  return {
    subject,
    publicKey: pushBase64(new Uint8Array(publicKey)),
    privateKey: privateKey.d!,
  };
}
export async function deliverReminders(
  engine: ReminderEngine,
  keys: VapidKeys,
  transaction: <T>(fn: () => T) => T,
  sender: typeof fetch = fetch,
) {
  const jobs = transaction(() => engine.claim());
  for (const job of jobs) {
    let sent = false,
      failed = false;
    for (const { id, device } of engine.devices(job.userId)) {
      if (
        !transaction(() =>
          engine.active(job.userId, job.rule.id, job.version, id),
        )
      )
        continue;
      if (engine.delivered(job.userId, job.rule.id, job.version, id)) {
        sent = true;
        continue;
      }
      try {
        // Notifications never contain a journal, conversation, plan title or name.
        const payload = await buildPushPayload(
          {
            data: JSON.stringify({
              title:
                job.rule.kind === "daily"
                  ? "Your check-in reminder"
                  : "Your saved-plan reminder",
              body: "Open Mira when it suits you.",
              tag: `mira-${job.version}`,
              url: "/app?view=activities&tab=reminders",
            }),
            options: { ttl: 300 },
          },
          { ...device, expirationTime: device.expirationTime ?? null },
          keys,
        );
        if (
          !transaction(() =>
            engine.active(job.userId, job.rule.id, job.version, id),
          )
        )
          continue;
        const response = await sender(device.endpoint, {
          ...payload,
          redirect: "manual",
          signal: AbortSignal.timeout(8000),
        });
        await response.body?.cancel();
        if (response.status === 404 || response.status === 410)
          transaction(() => engine.unsubscribe(job.userId, id));
        else if (response.ok) {
          sent = true;
          transaction(() =>
            engine.recordDelivered(job.userId, job.rule.id, job.version, id),
          );
        } else failed = true;
      } catch (cause) {
        failed = true;
        console.warn(
          JSON.stringify({
            event: "reminder-delivery-failed",
            kind: cause instanceof Error ? cause.name : "unknown",
          }),
        );
      }
    }
    transaction(() =>
      engine.finish(
        job.userId,
        job.rule.id,
        job.version,
        failed ? "retry" : sent ? "sent" : "expired",
      ),
    );
  }
}
