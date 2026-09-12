import { billingClient,billingEntitlement } from "@/lib/billing";
import { AccountError,accountErrorResponse,assertSameOrigin,requireAccount } from "@/lib/account-server";
import { edgeRateLimited } from "@/lib/edge-security";
export async function POST(request:Request){
  try{
    assertSameOrigin(request);const {account}=await requireAccount(request);
    if(await edgeRateLimited(request,"checkout",3,900))throw new AccountError("Please wait before opening another checkout.",429);
    const {client,env}=await billingClient();
    const {record}=await billingEntitlement(account.id);
    if(record?.status==="active")throw new AccountError("Manage your existing subscription instead of starting another.",409);
    const session=await client.checkoutSessions.create({product_cart:[{product_id:env.DODO_PRODUCT_ID!,quantity:1}],customer:record?.customerId?{customer_id:record.customerId}:{email:account.email,name:account.name},metadata:{app_user_id:account.id},return_url:new URL("/app?billing=return",env.SITE_ORIGIN!).href,cancel_url:new URL("/app",env.SITE_ORIGIN!).href});
    return Response.json({url:session.checkout_url},{headers:{"cache-control":"no-store"}});
  }catch(cause){return accountErrorResponse(cause);}
}
