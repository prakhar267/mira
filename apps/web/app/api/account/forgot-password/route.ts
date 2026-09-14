import { AccountError, accountErrorResponse, assertSameOrigin, parseJsonObject, sha256 } from "@/lib/account-server";
import { edgeRateLimited } from "@/lib/edge-security";
import { storeAction } from "@/lib/cloud-store";
import { requestAccountMail } from "@/lib/mail-request";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (await edgeRateLimited(request, "recovery", 4, 900)) throw new AccountError("Please wait fifteen minutes before requesting another link.", 429);
    const { email: input } = await parseJsonObject(request, 1000);
    const email = typeof input === "string" ? input.trim().toLowerCase() : "";
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) throw new AccountError("Enter a valid email address.");
    if ((await storeAction<{ limited: boolean }>({ action: "rate", key: `mail:${await sha256(email)}`, max: 3, seconds: 900 })).limited) throw new AccountError("Please wait before requesting another link.", 429);
    const { env } = await import(/* webpackIgnore: true */ "cloudflare:workers");
    return Response.json(await requestAccountMail(email, "recovery", env), { headers: { "cache-control": "no-store" } });
  } catch (cause) { return accountErrorResponse(cause); }
}
