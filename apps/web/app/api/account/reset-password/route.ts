import { AccountError, accountErrorResponse, assertSameOrigin, clearSessionCookie, parseJsonObject, resetPasswordWithToken } from "@/lib/account-server";
import { edgeRateLimited } from "@/lib/edge-security";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if(await edgeRateLimited(request,"password-reset",10,900)) throw new AccountError("Too many attempts. Try again later.",429);
    const body = await parseJsonObject(request,1500);
    if (typeof body.token !== "string" || typeof body.password !== "string") throw new AccountError("Enter your reset token and new password.");
    await resetPasswordWithToken(body.token,body.password);
    return Response.json({reset:true},{headers:{"set-cookie":clearSessionCookie(),"cache-control":"no-store"}});
  } catch(cause) { return accountErrorResponse(cause); }
}
