import { requireOperator } from "@/lib/operations";
import { AccountError, accountErrorResponse, assertSameOrigin, parseJsonObject } from "@/lib/account-server";

/** Explicit operator-only encrypted archive transport. The recovery target is
 * never selected by normal account requests and cannot replace production here. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request); await requireOperator(request);
    const data = await parseJsonObject(request, 2_600_000);
    const target = data.target ?? "mira-production-v1";
    if (typeof target !== "string" || (target !== "mira-production-v1" && !/^mira-recovery-[a-z0-9-]{8,80}$/.test(target))) throw new AccountError("An explicit valid backup or isolated recovery target is required.", 400, "BACKUP_TARGET_INVALID");
    if (data.operation === "retire" && target !== "mira-production-v1") throw new AccountError("Source retirement confirmation applies only to the explicitly named production source.", 400, "CUTOVER_CONFIRMATION_REQUIRED");
    const { env } = await import(/* webpackIgnore: true */ "cloudflare:workers");
    if (!env.MIRA_BACKUP_KEY || !env.MIRA_BACKUP_KEY_ID || !env.MIRA_STORE) throw new AccountError("Encrypted backup key and key ID are not configured. No export or recovery was started.", 503, "BACKUP_KEY_REQUIRED");
    const protectedMode=data.version===2;
    if(protectedMode&&env.MIRA_PROTECTED_RECOVERY_ENABLED!=="true")throw new AccountError("Protected recovery is not activated by the operator.",503,"RECOVERY_V2_DISABLED");
    if(data.version!==undefined&&!protectedMode)throw new AccountError("Unsupported backup protocol version.",400,"BACKUP_VERSION_INVALID");
    const operation={...data};delete operation.version;
    const result = await env.MIRA_STORE.get(env.MIRA_STORE.idFromName(target)).fetch("https://store.internal/", { method: "POST", body: JSON.stringify({ ...operation, target, action: protectedMode?"protectedRecovery":"backup" }) });
    return new Response(result.body, { status: result.status, headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  } catch (cause) { return accountErrorResponse(cause); }
}
