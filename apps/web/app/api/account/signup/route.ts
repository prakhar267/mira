import { AccountError, accountErrorResponse, assertSameOrigin, createAccount, createSession, parseJsonObject, publicAccount, throttle, writeState } from "@/lib/account-server";
import { billingEntitlement } from "@/lib/billing";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await parseJsonObject(request);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const rawState = body.state && typeof body.state === "object" && !Array.isArray(body.state) ? body.state as Record<string, unknown> : null;
    if (!rawState) throw new AccountError("Companion setup data is missing.");
    const rawUser = rawState.user && typeof rawState.user === "object" && !Array.isArray(rawState.user) ? rawState.user as Record<string, unknown> : {};
    if(rawUser.adultConfirmed!==true)throw new AccountError("Mira is for adults 18+ only. Confirm your age before creating an account.",403);
    await throttle(request, "signup", email, 5);
    const account = await createAccount(body);
    const {subscription}=await billingEntitlement(account.id);
    const state = { ...rawState, subscription, user: { ...rawUser, id: account.id, name: account.name } };
    await writeState(account.id, state);
    const cookie = await createSession(account);
    return Response.json({ account: publicAccount(account), state }, { status: 201, headers: { "cache-control": "no-store", "set-cookie": cookie } });
  } catch (cause) {
    return accountErrorResponse(cause);
  }
}
