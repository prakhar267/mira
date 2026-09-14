import { ACCOUNT_POLICY_VERSION, decodeAccountState, MAX_ACCOUNT_MESSAGES, ownAccountState, STATE_MESSAGE_WINDOW, validateAccountState, type MemoryCommand, type StateEnvelope } from "./account-state-schema";
import type { DemoState } from "./state";
import { RecoveryJournal } from "./recovery-journal";

export interface InferenceReservation { service:string;tier:"demo"|"account";principal:string;attemptId:string;units:number;max:number;personalMax:number;unitMax:number;personalUnitMax:number;demoMax:number;concurrency:number;globalConcurrency?:number;demoConcurrency?:number;ttl:number }
export interface SqlStorage {
  exec(query: string, ...values: (string | number | null)[]): { toArray(): Record<string, unknown>[]; rowsWritten?: number };
}

/** One SQLite coordinator for this beta. SQL calls are synchronous and each
 * action runs inside a Durable Object transaction. No raw content is logged. */
export class StoreEngine {
  private recovery: RecoveryJournal;
  constructor(private sql: SqlStorage) {
    this.recovery = new RecoveryJournal(sql);
    sql.exec("CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, value TEXT, expires INTEGER, deleted INTEGER NOT NULL DEFAULT 0)");
    sql.exec("CREATE INDEX IF NOT EXISTS record_expiry ON records(expires)");
    sql.exec("CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS metrics (day TEXT, name TEXT, total INTEGER NOT NULL, failures INTEGER NOT NULL, duration INTEGER NOT NULL, PRIMARY KEY(day,name))");
    sql.exec("CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, received INTEGER NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS metric_windows (minute INTEGER, name TEXT, total INTEGER, failures INTEGER, duration INTEGER, max_duration INTEGER, le1000 INTEGER, le2500 INTEGER, le5000 INTEGER, le8000 INTEGER, le15000 INTEGER, PRIMARY KEY(minute,name))");
    sql.exec("CREATE TABLE IF NOT EXISTS transcripts (user_id TEXT, id TEXT, created_at TEXT, value TEXT NOT NULL, PRIMARY KEY(user_id,id))");
    sql.exec("CREATE INDEX IF NOT EXISTS transcript_page ON transcripts(user_id,created_at,id)");
    sql.exec("CREATE TABLE IF NOT EXISTS account_conversations (user_id TEXT,id TEXT,deleted INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(user_id,id))");
    sql.exec("CREATE TABLE IF NOT EXISTS memory_suppressions (user_id TEXT,id TEXT,forgotten_at INTEGER NOT NULL,PRIMARY KEY(user_id,id))");
    sql.exec("CREATE TABLE IF NOT EXISTS privacy_suppressions (user_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,ai_disabled INTEGER NOT NULL,history_disabled INTEGER NOT NULL,memory_disabled INTEGER NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS inference_leases (id TEXT PRIMARY KEY,service TEXT, tier TEXT, principal TEXT, expires INTEGER)");
  }
  row(key: string) { return this.sql.exec("SELECT * FROM records WHERE key = ?", key).toArray()[0]; }
  get(key: string) {
    const row = this.row(key);
    return row && !row.deleted && (!row.expires || Number(row.expires) > Date.now()) ? row.value as string : null;
  }
  put(key: string, value: string, ttl?: number) {
    const owner = /^(?:state|backup|account|account-policy):([^:]+)/.exec(key)?.[1]??(/^(?:session|recovery|verification):/.test(key)?JSON.parse(value).userId:undefined);
    if (owner && this.row(`account:${owner}`)?.deleted) throw new Error("Account was deleted");
    this.sql.exec("INSERT INTO records(key,value,expires,deleted) VALUES(?,?,?,0) ON CONFLICT(key) DO UPDATE SET value=excluded.value, expires=excluded.expires, deleted=0", key, value, ttl ? Date.now() + ttl * 1000 : null);
  }
  remove(key: string) {
    if (key.startsWith("account:") && !this.row(key)?.deleted) this.recovery.append({ kind: "account", userId: key.slice(8) });
    // Keep a content-free tombstone: old KV data must never be imported again.
    this.sql.exec("INSERT INTO records(key,value,deleted) VALUES(?,NULL,1) ON CONFLICT(key) DO UPDATE SET value=NULL,expires=NULL,deleted=1", key);
  }
  eraseAccount(userId:string, emailKey:string, legacyKeys:string[]) {
    const keys=new Set([`account:${userId}`,`state:${userId}`,`account-policy:${userId}`,`email:${emailKey}`,`billing:${userId}`,...legacyKeys]);
    for(const row of this.sql.exec("SELECT key FROM records WHERE key >= ? AND key < ?",`backup:${userId}:`,`backup:${userId}:\uffff`).toArray())keys.add(String(row.key));
    for(const row of this.sql.exec("SELECT key FROM records WHERE (key LIKE 'session:%' OR key LIKE 'recovery:%' OR key LIKE 'verification:%') AND deleted=0 AND json_valid(value) AND json_extract(value,'$.userId')=?",userId).toArray())keys.add(String(row.key));
    this.remove(`account:${userId}`); // Fence concurrent autosaves first, in this transaction.
    this.sql.exec("DELETE FROM transcripts WHERE user_id=?",userId);
    this.sql.exec("DELETE FROM account_conversations WHERE user_id=?",userId);
    this.sql.exec("DELETE FROM memory_suppressions WHERE user_id=?",userId);
    this.sql.exec("DELETE FROM privacy_suppressions WHERE user_id=?",userId);
    this.put(`purge-prefix:backup:${userId}:`,JSON.stringify({prefix:`backup:${userId}:`}));
    for(const key of keys){this.remove(key);this.put(`purge:${key}`,JSON.stringify({key}));}
    return [...keys];
  }
  private writeEnvelope(userId:string,envelope:StateEnvelope,snapshot=true) {
    const state=structuredClone(envelope.state);
    // A snapshot holds bounded profile state; transcripts have their own rows.
    state.messages=[];
    const encoded=JSON.stringify({...envelope,state});
    this.put(`state:${userId}`,encoded);
    const key=`backup:${userId}:${new Date().toISOString().slice(0,10)}`;
    if(snapshot&&!this.row(key))this.put(key,encoded,30*86400);
    const existing=JSON.parse(this.get(`account-policy:${userId}`)??"null");
    this.put(`account-policy:${userId}`,JSON.stringify({version:1,termsVersion:existing?.termsVersion??"legacy-self-declaration",adultDeclaredAt:existing?.adultDeclaredAt??new Date().toISOString(),consentUpdatedAt:new Date().toISOString(),aiProcessingConsent:state.aiProcessingConsent,memoryEnabled:state.memoryEnabled,conversationStorageEnabled:state.conversationStorageEnabled}));
    const previousPrivacy = this.sql.exec("SELECT * FROM privacy_suppressions WHERE user_id=?", userId).toArray()[0];
    if (!previousPrivacy || Boolean(previousPrivacy.ai_disabled) === state.aiProcessingConsent || Boolean(previousPrivacy.history_disabled) === state.conversationStorageEnabled || Boolean(previousPrivacy.memory_disabled) === state.memoryEnabled) this.recovery.append({ kind: "privacy", userId, revision: envelope.revision, ai: state.aiProcessingConsent, history: state.conversationStorageEnabled, memory: state.memoryEnabled });
    this.sql.exec("INSERT INTO privacy_suppressions(user_id,revision,ai_disabled,history_disabled,memory_disabled) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET revision=excluded.revision,ai_disabled=excluded.ai_disabled,history_disabled=excluded.history_disabled,memory_disabled=excluded.memory_disabled",userId,envelope.revision,state.aiProcessingConsent?0:1,state.conversationStorageEnabled?0:1,state.memoryEnabled?0:1);
  }
  private persistMessages(userId:string,state:DemoState) {
    if(!state.conversationStorageEnabled){this.sql.exec("DELETE FROM transcripts WHERE user_id=?",userId);return;}
    const previous=this.sql.exec("SELECT id,length(CAST(value AS BLOB)) AS bytes FROM transcripts WHERE user_id=?",userId).toArray();
    const existing=new Set(previous.map(row=>String(row.id)));
    const oldBytes=new Map(previous.map(row=>[String(row.id),Number(row.bytes)]));
    const conversations=new Set(this.sql.exec("SELECT id FROM account_conversations WHERE user_id=? AND deleted=0",userId).toArray().map(row=>String(row.id)));
    if(state.messages.some(message=>!conversations.has(message.conversationId)))throw new Error("CONVERSATION_REMOVED");
    if(existing.size+state.messages.filter(message=>!existing.has(message.id)).length>MAX_ACCOUNT_MESSAGES)throw new Error("TRANSCRIPT_LIMIT");
    const incoming=state.messages.map(message=>({message,encoded:JSON.stringify(message)}));
    const totalBytes=previous.reduce((sum,row)=>sum+Number(row.bytes),0)+incoming.reduce((sum,{message,encoded})=>sum+new TextEncoder().encode(encoded).byteLength-(oldBytes.get(message.id)??0),0);
    // Bound cumulative UTF-8 bytes as well as row count so complete JSON export
    // cannot grow beyond the Worker's memory/serialization envelope.
    if(totalBytes>8_000_000)throw new Error("TRANSCRIPT_LIMIT");
    for(const {message,encoded} of incoming)this.sql.exec("INSERT INTO transcripts(user_id,id,created_at,value) VALUES(?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET value=excluded.value WHERE transcripts.value<>excluded.value",userId,message.id,message.createdAt,encoded);
  }
  transcriptPage(userId:string,before?:string,limit=STATE_MESSAGE_WINDOW,conversationId?:string){
    if(!this.get(`account:${userId}`))return {messages:[],cursor:undefined};
    const boundary:[string,string]=before?JSON.parse(before) as [string,string]:["\uffff","\uffff"];
    const rows=this.sql.exec("SELECT id,created_at,value FROM transcripts WHERE user_id=? AND (? IS NULL OR json_extract(value,'$.conversationId')=?) AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC,id DESC LIMIT ?",userId,conversationId??null,conversationId??null,boundary[0],boundary[0],boundary[1],Math.min(STATE_MESSAGE_WINDOW,limit)+1).toArray();
    const selected=rows.slice(0,limit);
    return {messages:selected.map(row=>JSON.parse(String(row.value))).reverse(),cursor:rows.length>limit?JSON.stringify([selected.at(-1)!.created_at,selected.at(-1)!.id]):undefined};
  }
  private stateWindow(userId:string){
    const messages=this.transcriptPage(userId).messages;let bytes=0;
    for(let index=messages.length-1;index>=0;index--){bytes+=new TextEncoder().encode(JSON.stringify(messages[index])).byteLength;if(bytes>600_000)return messages.slice(index+1);}
    return messages;
  }
  readAccountState(userId:string):StateEnvelope|null {
    if(!this.get(`account:${userId}`))return null;
    const raw=this.get(`state:${userId}`);if(!raw)return null;
    const envelope=decodeAccountState(raw);
    if(envelope.revision===0){
      const historic=JSON.parse(raw) as {memories?:{id:string;status:string}[]};
      const deleted=historic.memories?.filter(memory=>memory.status==="deleted")??[];
      for(const memory of deleted){
        if(!this.sql.exec("SELECT id FROM memory_suppressions WHERE user_id=? AND id=?",userId,memory.id).toArray().length)this.recovery.append({kind:"memory",userId,id:memory.id});
        this.sql.exec("INSERT OR IGNORE INTO memory_suppressions(user_id,id,forgotten_at) VALUES(?,?,?)",userId,memory.id,Date.now());
      }
      if(deleted.length)envelope.state.companionReflections=[];
    }
    const suppressed=new Set(this.sql.exec("SELECT id FROM memory_suppressions WHERE user_id=?",userId).toArray().map(row=>String(row.id)));
    const beforeMemoryCount=envelope.state.memories.length;
    envelope.state.memories=envelope.state.memories.filter(memory=>!suppressed.has(memory.id)&&memory.status!=="deleted");
    const privacy=this.sql.exec("SELECT * FROM privacy_suppressions WHERE user_id=?",userId).toArray()[0];
    const needsPrivacyReplay=privacy&&Number(privacy.revision)>envelope.revision;
    if(needsPrivacyReplay){
      envelope.state.aiProcessingConsent=!privacy.ai_disabled;envelope.state.conversationStorageEnabled=!privacy.history_disabled;envelope.state.memoryEnabled=!privacy.memory_disabled;
      if(privacy.history_disabled){envelope.state.messages=[];envelope.state.calls=[];envelope.state.feedbackSignals=[];this.sql.exec("DELETE FROM transcripts WHERE user_id=?",userId);}
    }
    if(envelope.revision===0){
      envelope.state=ownAccountState(envelope.state,userId,envelope.state);
      for(const id of new Set([envelope.state.activeConversationId,...envelope.state.messages.map(message=>message.conversationId)]))this.sql.exec("INSERT OR IGNORE INTO account_conversations(user_id,id) VALUES(?,?)",userId,id);
      this.persistMessages(userId,envelope.state);envelope.revision=1;
      // Retire unversioned backups: they can contain old deleted-memory fields.
      this.eraseSnapshots(userId);
      this.writeEnvelope(userId,envelope,false);
    }else if(beforeMemoryCount!==envelope.state.memories.length||needsPrivacyReplay){
      // This also sanitizes restored active records, not merely their API view.
      envelope.state.companionReflections=[];envelope.state.futureEvents=envelope.state.futureEvents.filter(event=>!event.relatedMemoryId||!suppressed.has(event.relatedMemoryId));
      this.eraseSnapshots(userId);envelope.revision=Math.max(envelope.revision+1,Number(privacy?.revision??0));this.writeEnvelope(userId,envelope,false);
    }
    envelope.state.messages=this.stateWindow(userId);
    return envelope;
  }
  bootstrap(emailKey:string,account:{id:string},state:unknown,sessionKey:string,sessionValue:string,ttl:number,maximumAccounts=250){
    if(this.get(emailKey))return {created:false};
    const limit=Number.isInteger(maximumAccounts)&&maximumAccounts>=1&&maximumAccounts<=5000?maximumAccounts:250;
    if(Number(this.sql.exec("SELECT count(*) AS count FROM records WHERE key LIKE 'account:%' AND deleted=0").toArray()[0]?.count??0)>=limit)return {created:false,capacity:true};
    const normalized=ownAccountState(validateAccountState(state),account.id);
    this.put(`account:${account.id}`,JSON.stringify(account));this.put(emailKey,account.id);
    this.put(`account-policy:${account.id}`,JSON.stringify({version:1,termsVersion:ACCOUNT_POLICY_VERSION,adultDeclaredAt:new Date().toISOString()}));
    const envelope:StateEnvelope={schemaVersion:1,revision:1,state:normalized};
    this.sql.exec("INSERT INTO account_conversations(user_id,id) VALUES(?,?)",account.id,normalized.activeConversationId);
    this.persistMessages(account.id,normalized);this.writeEnvelope(account.id,envelope);
    this.put(sessionKey,sessionValue,ttl);
    return {created:true,...envelope};
  }
  saveAccountState(userId:string,input:unknown,revision:number){
    const current=this.readAccountState(userId);if(!current)return {missing:true};
    if(current.revision!==revision)return {conflict:true,revision:current.revision};
    const state=ownAccountState(validateAccountState(input),userId,current.state);
    if(current.state.conversationStorageEnabled&&!state.conversationStorageEnabled)this.eraseSnapshots(userId);
    this.persistMessages(userId,state);
    const next:StateEnvelope={schemaVersion:1,revision:revision+1,state};this.writeEnvelope(userId,next);
    return {...next,state:{...state,messages:this.stateWindow(userId)}};
  }
  acceptPolicy(userId:string,input:{aiProcessingConsent:boolean;memoryEnabled:boolean;conversationStorageEnabled:boolean},revision:number){
    if (JSON.parse(this.get(`account:${userId}`) ?? "null")?.recoveryVerificationRequired) throw new Error("ACCOUNT_VERIFICATION_REQUIRED");
    const current=this.readAccountState(userId);if(!current)return {missing:true};
    if(current.revision!==revision)return {conflict:true,revision:current.revision};
    const result=this.saveAccountState(userId,{...current.state,...input},revision);
    const evidence=JSON.parse(this.get(`account-policy:${userId}`)!);
    this.put(`account-policy:${userId}`,JSON.stringify({...evidence,termsVersion:ACCOUNT_POLICY_VERSION,adultDeclaredAt:new Date().toISOString()}));
    return result;
  }
  private eraseSnapshots(userId:string){
    for(const row of this.sql.exec("SELECT key FROM records WHERE key>=? AND key<?",`backup:${userId}:`,`backup:${userId}:\uffff`).toArray()){
      const key=String(row.key);this.remove(key);this.put(`purge:${key}`,JSON.stringify({key}));
    }
    this.put(`purge-prefix:backup:${userId}:`,JSON.stringify({prefix:`backup:${userId}:`}));
  }
  conversationCommand(userId:string,command:{action:"create"}|{action:"delete";id:string},revision:number){
    const current=this.readAccountState(userId);if(!current)return {missing:true};
    if(current.revision!==revision)return {conflict:true,revision:current.revision};
    if(command.action==="delete"){
      if(!this.sql.exec("SELECT id FROM account_conversations WHERE user_id=? AND id=? AND deleted=0",userId,command.id).toArray().length)return {notFound:true};
      this.sql.exec("UPDATE account_conversations SET deleted=1 WHERE user_id=? AND id=?",userId,command.id);
      this.recovery.append({ kind: "conversation", userId, id: command.id });
      this.sql.exec("DELETE FROM transcripts WHERE user_id=? AND json_extract(value,'$.conversationId')=?",userId,command.id);
      current.state.companionReflections=[];this.eraseSnapshots(userId);
    }
    const conversationId=crypto.randomUUID();this.sql.exec("INSERT INTO account_conversations(user_id,id) VALUES(?,?)",userId,conversationId);
    current.state.activeConversationId=conversationId;current.state.messages=this.stateWindow(userId);
    const next:StateEnvelope={...current,revision:revision+1};this.writeEnvelope(userId,next,false);return next;
  }
  memoryCommand(userId:string,command:MemoryCommand,revision:number){
    const current=this.readAccountState(userId);if(!current)return {missing:true};
    if(current.revision!==revision)return {conflict:true,revision:current.revision};
    const state=current.state;const now=new Date().toISOString();
    if(command.action==="create"){
      if(!state.memoryEnabled)return {consentRequired:true};
      if(state.memories.length>=300)return {limit:true};
      state.memories.push({id:crypto.randomUUID(),userId,companionId:state.companion.id,type:command.type??"semantic",content:command.content,normalizedContent:command.content.normalize("NFKC").toLowerCase(),importance:.7,confidence:1,sourceMessageIds:[],createdAt:now,updatedAt:now,retrievalCount:0,status:"active",pinned:command.pinned??false});
    }else{
      const target=state.memories.find(memory=>memory.id===command.id);
      if(!target)return {notFound:true};
      if (command.action === "forget" || command.content !== undefined) this.recovery.append({ kind: "memory", userId, id: command.id });
      if(command.action==="forget"){
        this.sql.exec("INSERT OR IGNORE INTO memory_suppressions(user_id,id,forgotten_at) VALUES(?,?,?)",userId,command.id,Date.now());
        state.memories=state.memories.filter(memory=>memory.id!==command.id);
        state.futureEvents=state.futureEvents.filter(event=>event.relatedMemoryId!==command.id);
      }else{if(command.content!==undefined){target.content=command.content;target.normalizedContent=command.content.normalize("NFKC").toLowerCase();target.sourceMessageIds=[];}if(command.pinned!==undefined)target.pinned=command.pinned;target.updatedAt=now;}
      // Derived prose cannot safely be edited with string substitution. Retire it.
      state.companionReflections=[];this.eraseSnapshots(userId);
    }
    const next:StateEnvelope={schemaVersion:1,revision:revision+1,state};this.writeEnvelope(userId,next,false);return next;
  }
  exportAccountState(userId:string){
    const current=this.readAccountState(userId);if(!current)return null;
    current.state.messages=this.sql.exec("SELECT value FROM transcripts WHERE user_id=? ORDER BY created_at,id",userId).toArray().map(row=>JSON.parse(String(row.value)));
    return current;
  }
  inferenceReserve(input:InferenceReservation){
    const now=Date.now(),day=Math.floor(now/86400000),retryAfter=Math.max(1,Math.ceil(((day+1)*86400000-now)/1000));
    this.sql.exec("DELETE FROM inference_leases WHERE expires<=?",now);
    if(this.sql.exec("SELECT id FROM inference_leases WHERE id=?",input.attemptId).toArray().length)return {allowed:true};
    const leases=this.sql.exec("SELECT tier,principal,expires FROM inference_leases WHERE service=?",input.service).toArray();
    if(leases.length>=(input.globalConcurrency??12)||leases.filter(row=>row.principal===input.principal).length>=input.concurrency||(input.tier==="demo"&&leases.filter(row=>row.tier==="demo").length>=(input.demoConcurrency??4)))return {allowed:false,reason:"concurrency",retryAfter:Math.max(1,Math.ceil((Math.min(...leases.map(row=>Number(row.expires)))-now)/1000))};
    const budgets:[string,number,number][]=[ [`capacity:${input.service}:${day}`,1,input.max],[`inference-units:${input.service}:${day}`,input.units,input.unitMax],[`inference-principal:${input.service}:${input.principal}:${day}`,1,input.personalMax],[`inference-principal-units:${input.service}:${input.principal}:${day}`,input.units,input.personalUnitMax] ];
    if(input.tier==="demo")budgets.push([`inference-demo:${input.service}:${day}`,1,input.demoMax],[`inference-demo-units:${input.service}:${day}`,input.units,Math.floor(input.unitMax*input.demoMax/Math.max(1,input.max))]);
    for(const [key,delta,max] of budgets){const row=this.sql.exec("SELECT count FROM limits WHERE key=?",key).toArray()[0];if(Number(row?.count??0)+delta>max)return {allowed:false,reason:"daily",retryAfter};}
    for(const [key,delta] of budgets)this.sql.exec("INSERT INTO limits(key,count,expires) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=count+excluded.count",key,delta,(day+2)*86400000);
    this.sql.exec("INSERT INTO inference_leases(id,service,tier,principal,expires) VALUES(?,?,?,?,?)",input.attemptId,input.service,input.tier,input.principal,now+input.ttl*1000);
    return {allowed:true};
  }
  inferenceRelease(attemptId:string){this.sql.exec("DELETE FROM inference_leases WHERE id=?",attemptId);}
  list(prefix: string, cursor = "", limit = 200) {
    return this.sql.exec("SELECT key FROM records WHERE key >= ? AND key < ? AND key > ? AND deleted=0 AND (expires IS NULL OR expires > ?) ORDER BY key LIMIT ?", prefix, `${prefix}\uffff`, cursor, Date.now(), limit + 1).toArray().map((r) => String(r.key));
  }
  rate(key: string, max: number, seconds: number) {
    const bucket = `${key}:${Math.floor(Date.now() / (seconds * 1000))}`;
    const row = this.sql.exec("INSERT INTO limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count", bucket, Date.now() + seconds * 2000).toArray()[0];
    return Number(row?.count) > max;
  }
  metric(name: string, failed: boolean, duration: number) {
    const ms = Math.max(0, Math.min(120000, Math.round(duration)));
    this.sql.exec("INSERT INTO metric_windows VALUES(?,?,1,?,?,?,?,?,?,?,?) ON CONFLICT(minute,name) DO UPDATE SET total=total+1,failures=failures+excluded.failures,duration=duration+excluded.duration,max_duration=max(max_duration,excluded.max_duration),le1000=le1000+excluded.le1000,le2500=le2500+excluded.le2500,le5000=le5000+excluded.le5000,le8000=le8000+excluded.le8000,le15000=le15000+excluded.le15000",Math.floor(Date.now()/60000),name,failed?1:0,ms,ms,...[1000,2500,5000,8000,15000].map(bound=>ms<=bound?1:0));
    this.sql.exec("INSERT INTO metrics(day,name,total,failures,duration) VALUES(?,?,1,?,?) ON CONFLICT(day,name) DO UPDATE SET total=total+1, failures=failures+excluded.failures, duration=duration+excluded.duration", new Date().toISOString().slice(0,10), name, failed ? 1 : 0, Math.max(0, Math.min(120000, Math.round(duration))));
  }
  metrics() { return this.sql.exec("SELECT day,name,total,failures,round(duration * 1.0 / total) AS averageLatencyMs FROM metrics WHERE day >= ? ORDER BY day DESC,name", new Date(Date.now()-7*86400000).toISOString().slice(0,10)).toArray(); }
  recentMetrics() {
    return this.sql.exec("SELECT name,sum(total) AS total,sum(failures) AS failures,round(sum(duration)*1.0/sum(total)) AS averageLatencyMs,max(max_duration) AS maxLatencyMs,sum(le1000) AS le1000,sum(le2500) AS le2500,sum(le5000) AS le5000,sum(le8000) AS le8000,sum(le15000) AS le15000 FROM metric_windows WHERE minute>=? GROUP BY name",Math.floor(Date.now()/60000)-14).toArray().map(row=>{const bound=(quantile:number)=>[1000,2500,5000,8000,15000].find(limit=>Number(row[`le${limit}`])>=Number(row.total)*quantile)??120000;return {...row,p50UpperBoundMs:bound(.50),p95UpperBoundMs:bound(.95),p99UpperBoundMs:bound(.99),windowMinutes:15};});
  }
  capacity() { return this.sql.exec("SELECT key,count FROM limits WHERE key LIKE 'capacity:%' AND key LIKE ?",`%:${Math.floor(Date.now()/86400000)}`).toArray(); }
  storageStats(){
    return {
      records:this.sql.exec("SELECT count(*) AS rows,sum(CASE WHEN deleted=1 THEN 1 ELSE 0 END) AS tombstones,coalesce(sum(length(CAST(value AS BLOB))),0) AS logicalValueBytes FROM records").toArray()[0],
      transcripts:this.sql.exec("SELECT count(*) AS rows,coalesce(sum(length(CAST(value AS BLOB))),0) AS logicalValueBytes FROM transcripts").toArray()[0],
      memorySuppressions:Number(this.sql.exec("SELECT count(*) AS count FROM memory_suppressions").toArray()[0]?.count??0),
      privacySuppressions:Number(this.sql.exec("SELECT count(*) AS count FROM privacy_suppressions").toArray()[0]?.count??0),
      pendingLegacyPurges:Number(this.sql.exec("SELECT count(*) AS count FROM records WHERE deleted=0 AND (key LIKE 'purge:%' OR key LIKE 'purge-prefix:%')").toArray()[0]?.count??0),
      activeInferenceLeases:Number(this.sql.exec("SELECT count(*) AS count FROM inference_leases WHERE expires>?",Date.now()).toArray()[0]?.count??0),
      note:"Logical payload bytes exclude indexes, SQLite metadata, PITR history and provider charges; not a billing quota measurement.",
    };
  }
  cleanup() {
    // Tombstone expired records so stale KV values cannot return after cleanup.
    this.sql.exec("UPDATE records SET value=NULL,deleted=1,expires=NULL WHERE key IN (SELECT key FROM records WHERE expires <= ? AND deleted=0 ORDER BY expires LIMIT 500)", Date.now());
    this.sql.exec("DELETE FROM limits WHERE key IN (SELECT key FROM limits WHERE expires <= ? LIMIT 1000)", Date.now());
    this.sql.exec("DELETE FROM metrics WHERE day < ?", new Date(Date.now()-30*86400000).toISOString().slice(0,10));
    this.sql.exec("DELETE FROM receipts WHERE received < ?", Date.now()-90*86400000);
    this.sql.exec("DELETE FROM metric_windows WHERE minute < ?", Math.floor(Date.now()/60000)-1440);
    this.sql.exec("DELETE FROM inference_leases WHERE expires<=?",Date.now());
    // Demo sessions were never KV-backed. No migration tombstone is necessary.
    this.sql.exec("DELETE FROM records WHERE key LIKE 'demo-session:%' AND deleted=1");
  }
  resetPassword(tokenKey: string, hash: string, salt: string) {
    const token = this.get(tokenKey);
    if (!token) return false;
    const parsed=JSON.parse(token);const userId = parsed.userId as string;
    const raw = this.get(`account:${userId}`);
    if (!raw) return false;
    const account = JSON.parse(raw);
    const issuedAt=typeof parsed.createdAt==="number"?parsed.createdAt:Date.parse(parsed.createdAt);
    if(account.passwordChangedAt&&(!Number.isFinite(issuedAt)||issuedAt<=Date.parse(account.passwordChangedAt))){this.remove(tokenKey);return false;}
    account.passwordHash = hash; account.passwordSalt = salt;
    delete account.passwordResetRequired;
    account.passwordAlgorithm="pbkdf2-sha256";account.passwordIterations=100_000;
    account.passwordChangedAt = new Date().toISOString();
    this.put(`account:${userId}`, JSON.stringify(account));
    this.remove(tokenKey);
    return true;
  }
  verifyEmail(tokenKey:string){
    const raw=this.get(tokenKey);if(!raw)return false;
    const token=JSON.parse(raw);const accountRaw=this.get(`account:${token.userId}`);if(!accountRaw)return false;
    const account=JSON.parse(accountRaw);if(account.email!==token.email)return false;
    account.emailVerifiedAt=new Date().toISOString();delete account.recoveryVerificationRequired;this.put(`account:${account.id}`,JSON.stringify(account));this.remove(tokenKey);return true;
  }
  claimEmail(emailKey: string, account: { id: string }) {
    if (this.get(emailKey)) return false;
    this.put(`account:${account.id}`, JSON.stringify(account));
    this.put(emailKey, account.id);
    return true;
  }
  billing(id: string, userId: string, timestamp: string, subscription: Record<string, unknown>) {
    if (this.sql.exec("SELECT id FROM receipts WHERE id=?", id).toArray().length) return;
    const key = `billing:${userId}`;
    const current = JSON.parse(this.get(key) ?? "null");
    if (this.get(`account:${userId}`) && (!current || timestamp >= current.timestamp)) this.put(key, JSON.stringify({ ...subscription, timestamp }));
    this.sql.exec("INSERT INTO receipts(id,received) VALUES(?,?)", id, Date.now());
  }
}
