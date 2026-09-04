import { accountErrorResponse, assertSameOrigin, authenticate, createSession, parseJsonObject, publicAccount, throttle } from "@/lib/account-server";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await parseJsonObject(request, 20_000);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    await throttle(request, "login", email, 10);
    const account = await authenticate(body.email, body.password);
    const cookie = await createSession(account);
    return Response.json({ account: publicAccount(account) }, { headers: { "cache-control": "no-store", "set-cookie": cookie } });
  } catch (cause) {
    return accountErrorResponse(cause);
  }
}
