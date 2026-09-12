import { billingClient } from "@/lib/billing";
import { cloudStore,storeAction } from "@/lib/cloud-store";
export async function POST(request:Request){
  if(Number(request.headers.get("content-length")??0)>262144)return new Response("Too large",{status:413});
  const raw=await request.text();if(new TextEncoder().encode(raw).length>262144)return new Response("Too large",{status:413});
  let config;try {config=await billingClient();}catch{return new Response("Billing not configured",{status:503});}
  let event;
  try{event=await config.client.webhooks.unwrap(raw,{headers:{"webhook-id":request.headers.get("webhook-id")??"","webhook-timestamp":request.headers.get("webhook-timestamp")??"","webhook-signature":request.headers.get("webhook-signature")??""}});}catch{return new Response("Invalid webhook signature",{status:401});}
  if(!event.type.startsWith("subscription."))return Response.json({received:true});
  // Only verified subscription payloads can change access. A checkout redirect cannot.
  const data=event.data as unknown as {metadata?:Record<string,string>;product_id?:string;subscription_id?:string;status?:string;customer?:{customer_id?:string};next_billing_date?:string;cancel_at_next_billing_date?:boolean};
  const userId=data.metadata?.app_user_id;
  if(!userId || !/^[a-f0-9-]{36}$/i.test(userId) || data.product_id!==config.env.DODO_PRODUCT_ID)return Response.json({received:true,ignored:true});
  if(!Number.isFinite(Date.parse(event.timestamp)) || !data.subscription_id)return new Response("Invalid subscription payload",{status:400});
  try{
    // Also triggers lazy migration for an existing KV account.
    if(await cloudStore.get(`account:${userId}`))await storeAction({action:"billing",key:request.headers.get("webhook-id"),userId,timestamp:new Date(event.timestamp).toISOString(),subscription:{subscriptionId:data.subscription_id,customerId:data.customer?.customer_id,status:data.status,renewsAt:data.next_billing_date,cancelAtPeriodEnd:data.cancel_at_next_billing_date}});
    return Response.json({received:true});
  }catch{return new Response("Retry delivery",{status:503});}
}
