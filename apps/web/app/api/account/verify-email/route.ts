import { AccountError, accountErrorResponse, assertSameOrigin, parseJsonObject, sha256 } from "@/lib/account-server";
import { edgeRateLimited } from "@/lib/edge-security";
import { storeAction } from "@/lib/cloud-store";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (await edgeRateLimited(request, "verify-email", 10, 900)) throw new AccountError("Too many attempts. Try again later.", 429);
    const { token } = await parseJsonObject(request, 1000);
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) throw new AccountError("Use the verification link from your email.");
    const result = await storeAction<{ verified: boolean }>({ action: "verifyEmail", key: `verification:${await sha256(token)}` });
    if (!result.verified) throw new AccountError("This verification link has expired or was already used.");
    return Response.json({ verified: true }, { headers: { "cache-control": "no-store" } });
  } catch (cause) { return accountErrorResponse(cause); }
}
