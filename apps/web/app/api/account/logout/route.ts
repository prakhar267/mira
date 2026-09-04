import { accountErrorResponse, assertSameOrigin, clearSessionCookie, requireAccount, revokeSession } from "@/lib/account-server";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { tokenHash } = await requireAccount(request);
    await revokeSession(tokenHash);
    return Response.json({ signedOut: true }, { headers: { "cache-control": "no-store", "set-cookie": clearSessionCookie() } });
  } catch (cause) {
    return accountErrorResponse(cause);
  }
}
