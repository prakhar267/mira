import { AccountError, accountErrorResponse, assertSameOrigin, parseJsonObject, sha256 } from "@/lib/account-server";
import { cloudStore } from "@/lib/cloud-store";
import { edgeRateLimited } from "@/lib/edge-security";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (await edgeRateLimited(request,"recovery",4,900)) throw new AccountError("Please wait fifteen minutes before requesting another link.",429);
    const {email:input} = await parseJsonObject(request,1000);
    const email = typeof input === "string" ? input.trim().toLowerCase() : "";
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length>254) throw new AccountError("Enter a valid email address.");
    const {env} = await import(/* webpackIgnore: true */ "cloudflare:workers");
    if (!env.RESEND_API_KEY || !env.EMAIL_FROM || !env.SITE_ORIGIN) throw new AccountError("Email recovery is not configured yet. Please contact support; no reset email has been sent.",503);
    const userId = await cloudStore.get(`email:${await sha256(email)}`);
    if (userId && await cloudStore.get(`account:${userId}`)) {
      const token = Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,"0")).join("");
      const key = `recovery:${await sha256(token)}`;
      await cloudStore.put(key,JSON.stringify({userId}),{expirationTtl:900});
      const url = new URL("/reset-password",env.SITE_ORIGIN); url.hash = `token=${token}`;
      const response = await fetch("https://api.resend.com/emails",{method:"POST",headers:{authorization:`Bearer ${env.RESEND_API_KEY}`,"content-type":"application/json"},body:JSON.stringify({from:env.EMAIL_FROM,to:[email],subject:"Reset your Mira password",text:`You requested a Mira password reset. This link expires in 15 minutes and can be used once:\n\n${url}\n\nIf this wasn't you, ignore this email.`}),signal:AbortSignal.timeout(8000)});
      if (!response.ok) { await cloudStore.delete(key); throw new AccountError("Email delivery is unavailable. Please try again later.",503); }
    }
    return Response.json({accepted:true,message:"If an account exists, recovery instructions have been requested."},{headers:{"cache-control":"no-store"}});
  } catch(cause) { return accountErrorResponse(cause); }
}
