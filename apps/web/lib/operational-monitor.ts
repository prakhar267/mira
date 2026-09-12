import type { LaunchEnvironment } from "./launch-readiness";

export interface MonitorStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: {expirationTtl?:number}): Promise<void>;
  recentMetrics(): Promise<Record<string,unknown>[]>;
  capacity(): Promise<{key:string;count:number}[]>;
}
type MonitorEnvironment = LaunchEnvironment & {CHAT_DAILY_LIMIT?:string;SPEECH_DAILY_LIMIT?:string;TRANSCRIBE_DAILY_LIMIT?:string};
export function monitorAlerts(metrics: Record<string,unknown>[], capacity:{key:string;count:number}[],env:MonitorEnvironment) {
  const alerts: {id:string;message:string}[]=[];
  for(const row of metrics) {
    const total=Number(row.total),failures=Number(row.failures),name=String(row.name);
    if(total>=10 && failures/total>.05) alerts.push({id:`errors:${name}`,message:`${name}: ${failures}/${total} requests failed or were limited in the last 15 minutes.`});
    if(total>=20 && (name.startsWith("api:companion")||name==="product:call_roundtrip_ms") && Number(row.p95UpperBoundMs)>5000) alerts.push({id:`latency:${name}`,message:`${name}: approximate P95 upper bound ${row.p95UpperBoundMs}ms in the last 15 minutes.`});
  }
  for(const row of capacity) {
    const service=row.key.split(":")[1];
    const max=Math.max(1,Math.min(10000,Number(service==="chat"?env.CHAT_DAILY_LIMIT:service==="speech"?env.SPEECH_DAILY_LIMIT:env.TRANSCRIBE_DAILY_LIMIT)||600));
    if(row.count>=max*.8) alerts.push({id:`capacity:${service}`,message:`Shared beta ${service} requests: ${row.count}/${max} today. Check upstream credits; this is an application cap, not a provider balance.`});
  }
  return alerts;
}
/** Cron does not call inference or consume speech credits. No user content is
 * included. Alert destination is explicitly configured by the operator. */
export async function runOperationalMonitor(env:MonitorEnvironment,store:MonitorStore,send:typeof fetch=fetch,source:"manual"|"durable-object-alarm"="manual") {
  let metrics:Record<string,unknown>[]=[],capacity:{key:string;count:number}[]=[],database=true;
  try {[metrics,capacity]=await Promise.all([store.recentMetrics(),store.capacity()]);}catch {database=false;}
  const alerts=database?monitorAlerts(metrics,capacity,env):[{id:"database",message:"Mira database health probe failed."}];
  let previous:{fingerprint?:string;deliveredFingerprint?:string;lastDeliveryAt?:string}={};
  try {previous=JSON.parse(await store.get("ops:monitor")??"{}");}catch{/* Still try delivery if storage is down. */}
  const fingerprint=alerts.map(alert=>alert.id).sort().join("|");
  const changed=fingerprint!==previous.deliveredFingerprint;
  let delivery="not-configured",deliveredFingerprint=previous.deliveredFingerprint,lastDeliveryAt=previous.lastDeliveryAt;
  if(env.MIRA_ALERT_WEBHOOK) {
    delivery="not-needed";
    if(changed && (alerts.length || previous.deliveredFingerprint)) {
      try {
        const url=new URL(env.MIRA_ALERT_WEBHOOK);
        if(url.protocol!=="https:" || url.username || url.password) throw new Error("Invalid alert destination");
        const response=await send(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text:alerts.length?`Mira needs attention:\n${alerts.map(a=>a.message).join("\n")}\nOpen your private /admin dashboard.`:"Mira recovery: the monitored error, latency and application-capacity alerts have cleared."}),redirect:"error",signal:AbortSignal.timeout(6000)});
        if(!response.ok)throw new Error("Delivery failed");
        delivery="delivered";deliveredFingerprint=fingerprint;lastDeliveryAt=new Date().toISOString();
      }catch {delivery="failed";}
    }
  }
  const state={checkedAt:new Date().toISOString(),source,database,alerts,delivery,fingerprint,deliveredFingerprint,lastDeliveryAt,windowMinutes:15,providerBalances:"not-probed"};
  try {await store.put("ops:monitor",JSON.stringify(state),{expirationTtl:30*86400});}catch{/* Structured log survives a database outage. */}
  return state;
}
