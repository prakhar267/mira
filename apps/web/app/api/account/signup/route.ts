import { accountErrorResponse, assertSameOrigin, bootstrapAccount, parseJsonObject, publicAccount, throttle } from "@/lib/account-server";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await parseJsonObject(request);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    await throttle(request, "signup", email, 5);
    const {account,state,revision,cookie}=await bootstrapAccount(body);
    return Response.json({ account: publicAccount(account), state,revision }, { status: 201, headers: { "cache-control": "no-store", "set-cookie": cookie } });
  } catch (cause) {
    return accountErrorResponse(cause);
  }
}
