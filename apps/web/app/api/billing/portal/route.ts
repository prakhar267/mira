import { billingClient,billingEntitlement } from "@/lib/billing";
import { AccountError,accountErrorResponse,assertSameOrigin,requireAccount } from "@/lib/account-server";
export async function POST(request:Request){try{
  assertSameOrigin(request);const {account}=await requireAccount(request);const {client,env}=await billingClient();
  const {record}=await billingEntitlement(account.id);if(!record?.customerId)throw new AccountError("No billing customer found.",404);
  const result=await client.customers.customerPortal.create(record.customerId,{return_url:new URL("/app",env.SITE_ORIGIN!).href});
  return Response.json({url:result.link},{headers:{"cache-control":"no-store"}});
}catch(cause){return accountErrorResponse(cause);}}
