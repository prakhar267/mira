import { accountErrorResponse, assertSameOrigin, parseJsonObject, publicAccount, readState, requireAccount, writeState } from "@/lib/account-server";
import { billingEntitlement } from "@/lib/billing";

export async function GET(request: Request) {
  try {
    const { account } = await requireAccount(request);
    const state=await readState(account.id) as Record<string,unknown>;
    const {subscription}=await billingEntitlement(account.id);
    return Response.json({ account: publicAccount(account), state:{...state,subscription} }, { headers: { "cache-control": "no-store" } });
  } catch (cause) {
    return accountErrorResponse(cause);
  }
}

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const { account } = await requireAccount(request);
    const body = await parseJsonObject(request);
    if (!body.state || typeof body.state !== "object" || Array.isArray(body.state)) throw new Error("Invalid state");
    const {subscription}=await billingEntitlement(account.id);
    // Client plan/entitlement fields are never authoritative.
    await writeState(account.id, {...body.state,subscription});
    return Response.json({ saved: true }, { headers: { "cache-control": "no-store" } });
  } catch (cause) {
    return accountErrorResponse(cause);
  }
}
