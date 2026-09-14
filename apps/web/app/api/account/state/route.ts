import { accountErrorResponse, assertSameOrigin, parseJsonObject, publicAccount, readStateEnvelope, requireAccount, writeState } from "@/lib/account-server";
import { billingEntitlement } from "@/lib/billing";
import {cloudStore} from "@/lib/cloud-store";

export async function GET(request: Request) {
  try {
    const { account } = await requireAccount(request);
    const {state,revision}=await readStateEnvelope(account.id);
    const {subscription}=await billingEntitlement(account.id);
    const policy=JSON.parse(await cloudStore.get(`account-policy:${account.id}`)??"null");
    return Response.json({ account: publicAccount(account), state:{...state,subscription},revision,policy }, { headers: { "cache-control": "no-store",etag:`"${revision}"` } });
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
    const result=await writeState(account.id, {...body.state,subscription},body.revision);
    return Response.json({ saved: true,state:{...result.state,subscription},revision:result.revision }, { headers: { "cache-control": "no-store",etag:`"${result.revision}"` } });
  } catch (cause) {
    return accountErrorResponse(cause);
  }
}
