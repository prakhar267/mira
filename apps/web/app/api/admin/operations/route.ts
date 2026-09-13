import { requireOperator } from "@/lib/operations";
import { AccountError,accountErrorResponse,assertSameOrigin,parseJsonObject } from "@/lib/account-server";
import { cloudStore,storeAction } from "@/lib/cloud-store";
import { providerCircuitStatus } from "@/lib/provider-resilience";
import {launchReadiness} from "@/lib/launch-readiness";
import {monitorStore} from "@/lib/monitor-store";
import {monitorAlerts} from "@/lib/operational-monitor";
import {emailConfigured} from "@/lib/mail-outbox";
export async function GET(request:Request) {
  try {
    await requireOperator(request);
    const cursor=new URL(request.url).searchParams.get("cursor");
    const [{metrics},page,{capacity}]=await Promise.all([storeAction<{metrics:Record<string,unknown>[]}>({action:"metrics"}),cloudStore.list({prefix:"support:",limit:30,...(cursor?{cursor}:{})}),storeAction<{capacity:{key:string;count:number}[]}>({action:"capacity"})]);
    const tickets=(await Promise.all(page.keys.map(async({name})=>JSON.parse(await cloudStore.get(name)??"null")))).filter(Boolean);
    const {env}=await import(/* webpackIgnore: true */ "cloudflare:workers");
    const recentMetrics=await monitorStore.recentMetrics();
    const [storageStats,mailOutbox]=await Promise.all([storeAction<Record<string,unknown>>({action:"storageStats"}),storeAction<{pending:number;oldestWaitingMs:number;maxAttempts:number}>({action:"mailStatus"})]);
    const alerts=monitorAlerts(recentMetrics,capacity,env).map(a=>a.message);
    if(mailOutbox.pending>=50||mailOutbox.oldestWaitingMs>120000)alerts.push("Recovery/verification mail queue is delayed. Check provider acceptance failures and capacity; queued does not mean delivered.");
    return Response.json({metrics,recentMetrics,tickets,nextCursor:page.cursor,alerts,storageStats,mailOutbox,monitor:JSON.parse(await cloudStore.get("ops:monitor")??"null"),readiness:launchReadiness(env),circuits:providerCircuitStatus(),configuration:{recovery:emailConfigured(env),billing:env.BILLING_ENABLED==="true",storage:"sqlite-durable-object",circuitScope:"this-worker-isolate",capacity,retention:"metrics 30 days; minute buckets 24 hours; support 90 days; mail jobs at most 15 minutes"}},{headers:{"cache-control":"no-store"}});
  } catch(cause){return accountErrorResponse(cause);}
}
export async function PATCH(request:Request) {
  try {
    assertSameOrigin(request);await requireOperator(request);
    const {ticketId,status}=await parseJsonObject(request,1000);
    if(typeof ticketId!=="string" || !/^MIRA-[A-Z0-9-]+$/.test(ticketId) || !["new","investigating","resolved"].includes(String(status)))throw new AccountError("Invalid ticket update.");
    const key=`support:${ticketId}`,raw=await cloudStore.get(key);if(!raw)throw new AccountError("Ticket not found.",404);
    const ticket=JSON.parse(raw);const remaining=Math.ceil((Date.parse(ticket.createdAt)+90*86400000-Date.now())/1000);
    if(remaining<=0)throw new AccountError("Ticket expired.",404);
    await cloudStore.put(key,JSON.stringify({...ticket,status,updatedAt:new Date().toISOString()}),{expirationTtl:remaining});
    return Response.json({updated:true},{headers:{"cache-control":"no-store"}});
  } catch(cause){return accountErrorResponse(cause);}
}
