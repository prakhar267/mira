import { AccountError, accountErrorResponse, assertSameOrigin, requireAccount } from "@/lib/account-server";
import { edgeRateLimited } from "@/lib/edge-security";
import { requestAccountMail } from "@/lib/mail-request";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { account } = await requireAccount(request);
    if (await edgeRateLimited(request, "verification", 3, 900)) throw new AccountError("Please wait fifteen minutes before requesting another link.", 429);
    const { env } = await import(/* webpackIgnore: true */ "cloudflare:workers");
    return Response.json(await requestAccountMail(account.email, "verification", env), { headers: { "cache-control": "no-store" } });
  } catch (cause) { return accountErrorResponse(cause); }
}
