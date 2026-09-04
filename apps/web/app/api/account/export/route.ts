import { accountErrorResponse, publicAccount, readState, requireAccount } from "@/lib/account-server";

export async function GET(request: Request) {
  try {
    const { account } = await requireAccount(request);
    return Response.json({ exportedAt: new Date().toISOString(), account: publicAccount(account), state: await readState(account.id) }, { headers: { "cache-control": "no-store" } });
  } catch (cause) {
    return accountErrorResponse(cause);
  }
}
