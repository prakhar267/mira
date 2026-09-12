import handler from "vinext/server/fetch-handler";
import { StoreEngine, type SqlStorage } from "./lib/store-engine";
import {runOperationalMonitor} from "./lib/operational-monitor";
import type {LaunchEnvironment} from "./lib/launch-readiness";
export {MiraRecoveryDrill} from "./lib/recovery-drill";

interface LegacyKV {
  get(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
  list(options: { prefix: string; cursor?: string; limit?: number }): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }>;
}
interface State {
  storage: { sql: SqlStorage; transactionSync<T>(callback: () => T): T; setAlarm(time: number): Promise<void>; getAlarm(): Promise<number | null> };
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}
export class MiraStore {
  private engine: StoreEngine;
  constructor(private ctx: State, private env: LaunchEnvironment & { LUMA_ACCOUNTS?: LegacyKV }) {
    this.engine = new StoreEngine(ctx.storage.sql);
    void ctx.blockConcurrencyWhile(async () => {
      const alarm=await ctx.storage.getAlarm();
      // Reuse this store's existing alarm: account-wide free cron slots may be
      // occupied. Keep a pending deletion retry, otherwise bootstrap in a minute.
      if(alarm===null || alarm>Date.now()+15*60000)await ctx.storage.setAlarm(Date.now()+60000);
    });
  }
  private async importLegacy(key: string) {
    if (this.engine.row(key)) return;
    const value = await this.env.LUMA_ACCOUNTS?.get(key);
    if (!value) return;
    let ttl: number | undefined;
    if (key.startsWith("session:")) ttl = Math.ceil((Date.parse(JSON.parse(value).createdAt) + 30*86400000 - Date.now())/1000);
    if (key.startsWith("backup:")) ttl = Math.ceil((Date.parse(key.slice(-10)) + 30*86400000 - Date.now())/1000);
    if (key.startsWith("support:")) ttl = Math.ceil((Date.parse(JSON.parse(value).createdAt) + 90*86400000 - Date.now())/1000);
    if (ttl !== undefined && (!Number.isFinite(ttl) || ttl <= 0)) { this.engine.remove(key); return; }
    this.engine.put(key, value, ttl);
  }
  async fetch(request: Request) {
    // This class is reachable only by the Worker binding, never a public route.
    const data = await request.json() as { action: string; key?: string; value?: string; ttl?: number; prefix?: string; cursor?: string; limit?: number; max?: number; seconds?: number; name?: string; failed?: boolean; duration?: number; hash?: string; salt?: string; account?: { id: string }; userId?: string; timestamp?: string; subscription?: Record<string, unknown>; emailKey?:string; keys?:string[] };
    return this.ctx.blockConcurrencyWhile(async () => {
      try {
        if (data.key && ["get", "claimEmail", "resetPassword"].includes(data.action)) await this.importLegacy(data.key);
        if (data.action === "list" && (data.prefix?.startsWith("backup:") || data.prefix==="support:") && this.env.LUMA_ACCOUNTS) {
          let cursor: string | undefined;
          do { const page = await this.env.LUMA_ACCOUNTS.list({ prefix: data.prefix, ...(cursor ? {cursor} : {}) }); for (const key of page.keys) await this.importLegacy(key.name); cursor = page.list_complete ? undefined : page.cursor; } while(cursor);
        }
        const result = this.ctx.storage.transactionSync(() => {
          switch(data.action) {
            case "get": return { value: this.engine.get(data.key!) };
            case "put": this.engine.put(data.key!, data.value!, data.ttl); return { ok: true };
            case "delete": this.engine.remove(data.key!); return { ok: true };
            case "eraseAccount": return {keys:this.engine.eraseAccount(data.userId!,data.emailKey!,data.keys??[])};
            case "list": {
              const limit = Math.min(200, data.limit ?? 200), keys = this.engine.list(data.prefix ?? "", data.cursor, limit);
              return { keys: keys.slice(0,limit).map(name => ({name})), list_complete: keys.length <= limit, cursor: keys.length > limit ? keys[limit-1] : undefined };
            }
            case "rate": return { limited: this.engine.rate(data.key!, data.max!, data.seconds!) };
            case "metric": this.engine.metric(data.name!, Boolean(data.failed), data.duration ?? 0); return { ok: true };
            case "metrics": return { metrics: this.engine.metrics() };
            case "recentMetrics": return { metrics: this.engine.recentMetrics() };
            case "capacity":return {capacity:this.engine.capacity()};
            case "resetPassword": return { reset: this.engine.resetPassword(data.key!, data.hash!, data.salt!) };
            case "claimEmail": return { created: this.engine.claimEmail(data.key!, data.account!) };
            case "billing": this.engine.billing(data.key!, data.userId!, data.timestamp!, data.subscription!); return { ok: true };
            default: throw new Error("Unknown store action");
          }
        });
        // Retain failed deletions for retry: the authoritative tombstone already denies access.
        if (data.action === "delete") {
          this.engine.put(`purge:${data.key!}`,JSON.stringify({key:data.key}));
          await this.purgeLegacy();
        }
        if (data.action === "eraseAccount") await this.purgeLegacy();
        return Response.json(result);
      } catch { return Response.json({ error: "Storage operation unavailable" }, { status: 503 }); }
    });
  }
  private async purgeLegacy() {
    for(const marker of this.engine.list("purge:","",100).slice(0,100)){
      const key=JSON.parse(this.engine.get(marker)!).key as string;
      try {await this.env.LUMA_ACCOUNTS?.delete(key);this.engine.remove(marker);}catch{/* Content is already blocked by tombstones. Retry in the alarm. */}
    }
    if(this.engine.list("purge:","",1).length)await this.ctx.storage.setAlarm(Date.now()+60000);
  }
  async alarm() {
    await this.ctx.storage.setAlarm(Date.now()+15*60000);
    if(Date.now()-Number(this.engine.get("ops:cleanup-at")??0)>=86400000) {
      this.engine.cleanup();this.engine.put("ops:cleanup-at",String(Date.now()));
    }
    await this.purgeLegacy();
    // Direct adapter, not the MIRA_STORE binding: calling the same object's
    // public fetch from its alarm could deadlock. No user content is reported.
    const state=await runOperationalMonitor(this.env,{
      get:async key=>this.engine.get(key),
      put:async(key,value,options)=>{this.engine.put(key,value,options?.expirationTtl);},
      recentMetrics:async()=>this.engine.recentMetrics(),
      capacity:async()=>this.engine.capacity().map(row=>({key:String(row.key),count:Number(row.count)})),
    },fetch,"durable-object-alarm");
    console.log(JSON.stringify({event:"mira-monitor",source:state.source,checkedAt:state.checkedAt,database:state.database,alerts:state.alerts.map(a=>a.id),delivery:state.delivery}));
  }
}
export default handler;
