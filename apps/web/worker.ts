import handler from "vinext/server/fetch-handler";
import { StoreEngine, type SqlStorage, type InferenceReservation } from "./lib/store-engine";
import { decodeAccountState, type MemoryCommand } from "./lib/account-state-schema";
import {runOperationalMonitor} from "./lib/operational-monitor";
import type {LaunchEnvironment} from "./lib/launch-readiness";
import { MailOutboxEngine, type MailJob } from "./lib/mail-outbox-engine";
import { runMailOutbox } from "./lib/mail-outbox";
import { BackupEngine } from "./lib/backup-engine";
import { runBackupOperation, type BackupEnvironment } from "./lib/backup-operations";
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
  private mail: MailOutboxEngine;
  private backup: BackupEngine;
  constructor(private ctx: State, private env: LaunchEnvironment & BackupEnvironment & { LUMA_ACCOUNTS?: LegacyKV }) {
    this.engine = new StoreEngine(ctx.storage.sql);
    this.mail = new MailOutboxEngine(ctx.storage.sql);
    this.backup = new BackupEngine(ctx.storage.sql, this.engine);
    void ctx.blockConcurrencyWhile(async () => {
      const alarm=await ctx.storage.getAlarm();
      // Reuse this store's existing alarm: account-wide free cron slots may be
      // occupied. Keep a pending deletion retry, otherwise bootstrap in a minute.
      if(alarm===null || alarm>Date.now()+15*60000)await ctx.storage.setAlarm(Date.now()+60000);
    });
  }
  private async importLegacy(key: string) {
    if (!this.backup.legacyAllowed()) return;
    if (this.engine.row(key)) return;
    const value = await this.env.LUMA_ACCOUNTS?.get(key);
    if (!value) return;
    // Network reads run outside the critical section. Recheck inside the atomic
    // transaction so a concurrent save/deletion always wins over stale KV.
    this.ctx.storage.transactionSync(()=>{
      this.backup.assertAvailable();
      if (!this.backup.legacyAllowed()) return;
      if(this.engine.row(key))return;
      let ttl: number | undefined;
      if (key.startsWith("session:")) ttl = Math.ceil((Date.parse(JSON.parse(value).createdAt) + 30*86400000 - Date.now())/1000);
      if (key.startsWith("backup:")) ttl = Math.ceil((Date.parse(key.slice(-10)) + 30*86400000 - Date.now())/1000);
      if (key.startsWith("support:")) ttl = Math.ceil((Date.parse(JSON.parse(value).createdAt) + 90*86400000 - Date.now())/1000);
      if (ttl !== undefined && (!Number.isFinite(ttl) || ttl <= 0)) { this.engine.remove(key); return; }
      const owner=/^(?:state|backup|account):([^:]+)/.exec(key)?.[1];
      if(owner&&this.engine.row(`account:${owner}`)?.deleted){this.engine.remove(key);return;}
      if(key.startsWith("state:")||key.startsWith("backup:"))decodeAccountState(value);
      this.engine.put(key, value, ttl);
    });
  }
  private availableTransaction<T>(work: () => T) { return this.ctx.storage.transactionSync(() => { this.backup.assertAvailable(); return work(); }); }
  async fetch(request: Request) {
    // This class is reachable only by the Worker binding, never a public route.
    const data = await request.json() as { action: string; key?: string; value?: string; ttl?: number; prefix?: string; cursor?: string; limit?: number; max?: number; seconds?: number; name?: string; failed?: boolean; duration?: number; hash?: string; salt?: string; account?: { id: string }; userId?: string; timestamp?: string; subscription?: Record<string, unknown>; emailKey?:string; keys?:string[];state?:unknown;revision?:number;sessionKey?:string;sessionValue?:string;command?:MemoryCommand;attemptId?:string };
      try {
        if (data.action === "backup") return Response.json(await runBackupOperation(this.backup, work => this.ctx.storage.transactionSync(work), this.env, data as unknown as Record<string, unknown>));
        this.ctx.storage.transactionSync(() => this.backup.assertAvailable());
        if (data.key && ["get", "claimEmail", "bootstrap", "resetPassword"].includes(data.action)) await this.importLegacy(data.key);
        if(data.userId&&["stateRead","stateSave","stateExport","memoryCommand"].includes(data.action))await this.importLegacy(`state:${data.userId}`);
        if (data.action === "list" && (data.prefix?.startsWith("backup:") || data.prefix==="support:") && this.env.LUMA_ACCOUNTS) {
          // A list schedules a bounded background migration. It never scans the
          // legacy namespace while another user's request waits for this object.
          const marker=`migration:${data.prefix}`;
          if(!this.engine.row(marker))this.engine.put(marker,JSON.stringify({prefix:data.prefix}));
        }
        const result = this.ctx.storage.transactionSync(() => {
          this.backup.assertAvailable();
          switch(data.action) {
            case "get": return { value: this.engine.get(data.key!) };
            case "put": this.engine.put(data.key!, data.value!, data.ttl); return { ok: true };
            case "delete": this.engine.remove(data.key!);this.engine.put(`purge:${data.key!}`,JSON.stringify({key:data.key}));return { ok: true };
            case "eraseAccount": {
              const account = JSON.parse(this.engine.get(`account:${data.userId!}`) ?? "null") as {email?:string}|null;
              if(account?.email)this.mail.purgeByEmail(account.email);
              return {keys:this.engine.eraseAccount(data.userId!,data.emailKey!,data.keys??[])};
            }
            case "mailEnqueue": return this.mail.enqueue((data as unknown as {job:MailJob}).job);
            case "mailStatus": return this.mail.status();
            case "list": {
              const limit = Math.min(200, data.limit ?? 200), keys = this.engine.list(data.prefix ?? "", data.cursor, limit);
              return { keys: keys.slice(0,limit).map(name => ({name})), list_complete: keys.length <= limit, cursor: keys.length > limit ? keys[limit-1] : undefined };
            }
            case "rate": return { limited: this.engine.rate(data.key!, data.max!, data.seconds!) };
            case "metric": this.engine.metric(data.name!, Boolean(data.failed), data.duration ?? 0); return { ok: true };
            case "metrics": return { metrics: this.engine.metrics() };
            case "recentMetrics": return { metrics: this.engine.recentMetrics() };
            case "capacity":return {capacity:this.engine.capacity()};
            case "storageStats":return this.engine.storageStats();
            case "resetPassword": return { reset: this.engine.resetPassword(data.key!, data.hash!, data.salt!) };
            case "claimEmail": return { created: this.engine.claimEmail(data.key!, data.account!) };
            case "bootstrap":return this.engine.bootstrap(data.key!,data.account!,data.state,data.sessionKey!,data.sessionValue!,data.ttl!,Number((this.env as unknown as Record<string,unknown>).MIRA_BETA_ACCOUNT_LIMIT??250));
            case "stateRead":return {envelope:this.engine.readAccountState(data.userId!)};
            case "stateSave":return this.engine.saveAccountState(data.userId!,data.state,data.revision!);
            case "acceptPolicy":return this.engine.acceptPolicy(data.userId!,(data as unknown as {policy:{aiProcessingConsent:boolean;memoryEnabled:boolean;conversationStorageEnabled:boolean}}).policy,data.revision!);
            case "stateExport":return {envelope:this.engine.exportAccountState(data.userId!)};
            case "memoryCommand":return this.engine.memoryCommand(data.userId!,data.command!,data.revision!);
            case "conversationCommand":return this.engine.conversationCommand(data.userId!,data.command as unknown as {action:"create"}|{action:"delete";id:string},data.revision!);
            case "transcriptPage":return this.engine.transcriptPage(data.userId!,data.cursor,data.limit,(data as unknown as {conversationId?:string}).conversationId);
            case "inferenceReserve":return this.engine.inferenceReserve(data as unknown as InferenceReservation);
            case "inferenceRelease":this.engine.inferenceRelease(data.attemptId!);return {ok:true};
            case "verifyEmail":return {verified:this.engine.verifyEmail(data.key!)};
            case "billing": this.engine.billing(data.key!, data.userId!, data.timestamp!, data.subscription!); return { ok: true };
            default: throw new Error("Unknown store action");
          }
        });
        if (data.action === "mailEnqueue") {
          const next=Date.now()+1000,current=await this.ctx.storage.getAlarm();
          if(current===null||current>next)await this.ctx.storage.setAlarm(next);
        }
        return Response.json(result);
      } catch(cause) { const code=cause instanceof Error&&(/^(?:BACKUP_|RESTORE_|CUTOVER_|SOURCE_ALREADY_RETIRED|RECOVERY_MAINTENANCE)/.test(cause.message)||["TRANSCRIPT_LIMIT","CONVERSATION_REMOVED","ACCOUNT_VERIFICATION_REQUIRED"].includes(cause.message))?cause.message:"STORAGE_UNAVAILABLE";return Response.json({ error:code==="ACCOUNT_VERIFICATION_REQUIRED"?"Verify your email after recovery before enabling AI processing.":"Storage operation unavailable",code }, { status:code==="ACCOUNT_VERIFICATION_REQUIRED"?403:code==="TRANSCRIPT_LIMIT"?413:code==="CONVERSATION_REMOVED"?409:503 }); }
  }
  private async migrateBatch(){
    for(const marker of this.engine.list("migration:","",1).slice(0,1)){
      const job=JSON.parse(this.engine.get(marker)!) as {prefix:string;cursor?:string};
      if(!this.env.LUMA_ACCOUNTS){this.availableTransaction(() => this.engine.remove(marker));continue;}
      const page=await this.env.LUMA_ACCOUNTS.list({prefix:job.prefix,...(job.cursor?{cursor:job.cursor}:{}),limit:25});
      await Promise.all(page.keys.map(key=>this.importLegacy(key.name)));
      this.availableTransaction(() => { if(page.list_complete)this.engine.remove(marker);else this.engine.put(marker,JSON.stringify({...job,cursor:page.cursor})); });
    }
  }
  private async purgeLegacy() {
    for(const marker of this.engine.list("purge:","",25).slice(0,25)){
      const key=JSON.parse(this.engine.get(marker)!).key as string;
      try {await this.env.LUMA_ACCOUNTS?.delete(key);this.availableTransaction(() => this.engine.remove(marker));}catch{/* Content is already blocked by tombstones. Retry in the alarm. */}
    }
    for(const marker of this.engine.list("purge-prefix:","",1).slice(0,1)){
      const job=JSON.parse(this.engine.get(marker)!) as {prefix:string;cursor?:string};
      try{
        if(!this.env.LUMA_ACCOUNTS){this.availableTransaction(() => this.engine.remove(marker));continue;}
        const page=await this.env.LUMA_ACCOUNTS.list({prefix:job.prefix,...(job.cursor?{cursor:job.cursor}:{}),limit:25});
        await Promise.all(page.keys.map(async({name})=>{await this.env.LUMA_ACCOUNTS!.delete(name);this.availableTransaction(() => this.engine.remove(name));}));
        this.availableTransaction(() => { if(page.list_complete)this.engine.remove(marker);else this.engine.put(marker,JSON.stringify({...job,cursor:page.cursor})); });
      }catch{/* Bounded batch retried by the alarm without reopening access. */}
    }
    if(this.engine.list("purge:","",1).length)await this.ctx.storage.setAlarm(Date.now()+60000);
  }
  async alarm() {
    await this.ctx.storage.setAlarm(Date.now()+15*60000);
    try { this.ctx.storage.transactionSync(() => this.backup.assertAvailable()); } catch { return; }
    if(Date.now()-Number(this.engine.get("ops:cleanup-at")??0)>=86400000) {
      this.engine.cleanup();this.engine.put("ops:cleanup-at",String(Date.now()));
    }
    await this.purgeLegacy();
    await this.migrateBatch().catch(()=>{/* Retry migration without delaying account operations. */});
    try { this.availableTransaction(() => undefined); } catch { return; }
    this.mail.cleanup();
    await runMailOutbox(this.env, {
      get: async key => { await this.importLegacy(key); return this.engine.get(key); },
      claim: async () => this.availableTransaction(() => this.mail.claim(Date.now(), 1)),
      pending: async id => this.mail.pending(id),
      prepareToken: async (job,userId) => this.availableTransaction(() => {
        const account=JSON.parse(this.engine.get(`account:${userId}`)??"null") as {passwordChangedAt?:string}|null;
        if (!this.mail.pending(job.id) || !account) return false;
        if(job.purpose==="recovery" && account.passwordChangedAt && Date.parse(account.passwordChangedAt)>=job.createdAt)return false;
        const key = `${job.purpose === "recovery" ? "recovery" : "verification"}:${job.tokenHash}`;
        const row = this.engine.row(key);
        if (row) return Boolean(this.engine.get(key));
        this.engine.put(key,JSON.stringify({userId,email:job.email,createdAt:job.createdAt}),Math.max(1,Math.floor((job.expiresAt-Date.now())/1000)));
        return true;
      }),
      complete: async (id,status) => { this.availableTransaction(()=>this.mail.complete(id,status)); },
      metric: async (failed,duration) => { this.availableTransaction(() => this.engine.metric("api:mail-provider-acceptance",failed,duration)); },
    });
    if(this.mail.status().pending)await this.ctx.storage.setAlarm(Date.now()+60_000);
    try { this.availableTransaction(() => undefined); } catch { return; }
    // Direct adapter, not the MIRA_STORE binding: calling the same object's
    // public fetch from its alarm could deadlock. No user content is reported.
    const state=await runOperationalMonitor(this.env,{
      get:async key=>this.engine.get(key),
      put:async(key,value,options)=>{this.availableTransaction(() => this.engine.put(key,value,options?.expirationTtl));},
      recentMetrics:async()=>this.engine.recentMetrics(),
      capacity:async()=>this.engine.capacity().map(row=>({key:String(row.key),count:Number(row.count)})),
    },fetch,"durable-object-alarm");
    console.log(JSON.stringify({event:"mira-monitor",source:state.source,checkedAt:state.checkedAt,database:state.database,alerts:state.alerts.map(a=>a.id),delivery:state.delivery}));
  }
}
export default handler;
