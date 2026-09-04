import { accountErrorResponse, assertSameOrigin, clearSessionCookie, deleteAccount, requireAccount } from "@/lib/account-server";

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const { account, tokenHash } = await requireAccount(request);
    await deleteAccount(account, tokenHash);
    return Response.json({ deleted: true }, { headers: { "cache-control": "no-store", "set-cookie": clearSessionCookie() } });
  } catch (cause) {
    return accountErrorResponse(cause);
  }
}
