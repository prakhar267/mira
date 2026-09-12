import { billingConfig,billingEntitlement } from "@/lib/billing";
import { requireAccount } from "@/lib/account-server";
export async function GET(request:Request){
  const {enabled,environment,env}=await billingConfig();
  let accountId:string|null=null;try {accountId=(await requireAccount(request)).account.id;}catch{}
  const entitlement=accountId?await billingEntitlement(accountId):null;
  return Response.json({enabled,environment,priceLabel:enabled?env.BILLING_PRICE_LABEL:null,signedIn:Boolean(accountId),hasSubscription:Boolean(entitlement?.record?.subscriptionId),subscription:entitlement?.subscription},{headers:{"cache-control":"no-store"}});
}
