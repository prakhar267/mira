import { accountErrorResponse, assertSameOrigin, parseJsonObject, publicAccount, readState, requireAccount, writeState } from "@/lib/account-server";

export async function GET(request: Request) {
  try {
    const { account } = await requireAccount(request);
    return Response.json({ account: publicAccount(account), state: await readState(account.id) }, { headers: { "cache-control": "no-store" } });
  } catch (cause) {
    return accountErrorResponse(cause);
  }
}

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const { account } = await requireAccount(request);
    const body = await parseJsonObject(request);
    await writeState(account.id, body.state);
    return Response.json({ saved: true }, { headers: { "cache-control": "no-store" } });
  } catch (cause) {
    return accountErrorResponse(cause);
  }
}
