import {DatabaseSync} from "node:sqlite";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {StoreEngine,type SqlStorage,type InferenceReservation} from "./store-engine";
import {initialState,type DemoState} from "./state";
import {decodeAccountState,validateAccountState} from "./account-state-schema";

let db:DatabaseSync,store:StoreEngine,failKey:string|undefined;
beforeEach(()=>{db=new DatabaseSync(":memory:");failKey=undefined;const sql:SqlStorage={exec(query,...values){if(failKey&&query.startsWith("INSERT INTO records")&&values[0]===failKey)throw new Error("synthetic failure");const rows=db.prepare(query).all(...values) as Record<string,unknown>[];return {toArray:()=>rows};}};store=new StoreEngine(sql);});
afterEach(()=>{db.close();vi.useRealTimers();});
function atomic<T>(run:()=>T){db.exec("BEGIN");try{const value=run();db.exec("COMMIT");return value;}catch(error){db.exec("ROLLBACK");throw error;}}
function fixture():DemoState{const state=structuredClone(initialState);state.messages=[];state.memories=[];state.companionReflections=[];state.calls=[];return state;}
function bootstrap(state=fixture(),id="u"){return atomic(()=>store.bootstrap(`email:${id}`,{id},state,`session:${id}`,JSON.stringify({userId:id,createdAt:new Date().toISOString()}),86400));}
function read(){return atomic(()=>store.readAccountState("u"))!;}
function reserve(overrides:Partial<InferenceReservation>={}){return atomic(()=>store.inferenceReserve({service:"chat",tier:"account",principal:"account:1",attemptId:crypto.randomUUID(),units:10,max:10,personalMax:10,unitMax:100,personalUnitMax:100,demoMax:4,concurrency:2,ttl:40,...overrides}));}

describe("versioned account boundaries",()=>{
  it("rejects malformed persisted versions and bounded fields",()=>{
    expect(()=>decodeAccountState('{"schemaVersion":9}')).toThrow();
    expect(()=>validateAccountState({...fixture(),futureEvents:Array(101).fill(initialState.futureEvents[0])})).toThrow();
    expect(()=>validateAccountState({...fixture(),companion:{...fixture().companion,personality:{warmth:2}}})).toThrow();
  });
  it("strips unknown properties and rejects inline/remote media and duplicate message IDs",()=>{
    expect(validateAccountState({...fixture(),admin:{role:"owner"}})).not.toHaveProperty("admin");
    for(const url of ["data:image/png;base64,secret","blob:local","https://tracking.invalid/photo.png","/assets/../private"]){const state=fixture();state.mediaLibrary=[{id:"upload",type:"image",url,name:"synthetic",createdAt:new Date().toISOString()}];expect(()=>validateAccountState(state)).toThrow();}
    const state=fixture();state.messages=[initialState.messages[0]!,initialState.messages[0]!];expect(()=>validateAccountState(state)).toThrow("Duplicate");
  });
  it("bootstraps all rows atomically and retry after a partial failure can claim email",()=>{
    failKey="session:u";expect(()=>bootstrap()).toThrow("synthetic failure");expect(store.get("email:u")).toBeNull();expect(store.get("account:u")).toBeNull();expect(store.get("state:u")).toBeNull();
    failKey=undefined;expect(bootstrap()).toMatchObject({created:true,revision:1});expect(bootstrap()).toEqual({created:false});
  });
  it("enforces the account cap inside bootstrap without denying existing accounts",()=>{
    bootstrap();const blocked=atomic(()=>store.bootstrap("email:v",{id:"v"},fixture(),"session:v",'{"userId":"v"}',86400,1));expect(blocked).toMatchObject({created:false,capacity:true});expect(store.get("email:v")).toBeNull();expect(read().state.user.id).toBe("u");
    atomic(()=>store.eraseAccount("u","u",[]));expect(atomic(()=>store.bootstrap("email:v",{id:"v"},fixture(),"session:v",'{"userId":"v"}',86400,1))).toMatchObject({created:true});
  });
  it("owns identifiers, entitlement and economic fields independently of submitted state",()=>{
    bootstrap();const before=read();const submitted=structuredClone(before.state);submitted.user.id="other";submitted.companion.id="other";submitted.activeConversationId="other";submitted.wallet.coins=100000;submitted.subscription.planId="ultra";submitted.memories=structuredClone(initialState.memories);
    atomic(()=>store.saveAccountState("u",submitted,before.revision));const after=read();expect(after.state.user.id).toBe("u");expect(after.state.companion.id).toBe(before.state.companion.id);expect(after.state.activeConversationId).toBe(before.state.activeConversationId);expect(after.state.wallet.coins).toBe(0);expect(after.state.subscription.planId).toBe("free");expect(after.state.memories).toEqual([]);
  });
  it("two tabs cannot overwrite a newer revision and a duplicate save cannot duplicate messages",()=>{
    bootstrap();const a=read(),b=read();a.state.messages=[{id:"synthetic-turn",conversationId:a.state.activeConversationId,role:"user",content:"Synthetic test only",createdAt:new Date().toISOString()}];
    expect(atomic(()=>store.saveAccountState("u",a.state,a.revision))).toMatchObject({revision:2});
    expect(atomic(()=>store.saveAccountState("u",b.state,b.revision))).toMatchObject({conflict:true,revision:2});
    expect(atomic(()=>store.saveAccountState("u",a.state,a.revision))).toMatchObject({conflict:true});expect(store.exportAccountState("u")!.state.messages).toHaveLength(1);
  });
  it("state plus first daily snapshot either both commit or neither commits",()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-09-13T12:00:00Z"));bootstrap();const current=read();vi.setSystemTime(new Date("2026-09-14T12:00:00Z"));failKey="backup:u:2026-09-14";current.state.user.name="new synthetic name";
    expect(()=>atomic(()=>store.saveAccountState("u",current.state,1))).toThrow();expect(read().revision).toBe(1);expect(read().state.user.name).not.toBe("new synthetic name");
  });
  it("snapshots once per day rather than every setting change",()=>{
    bootstrap();const key=store.list("backup:u:")[0]!;const first=store.get(key);const current=read();current.state.theme="dark";atomic(()=>store.saveAccountState("u",current.state,1));expect(store.get(key)).toBe(first);expect(read().revision).toBe(2);
  });
  it("moves transcript rows out of profile blobs and paginates owner-scoped without duplicates",()=>{
    const state=fixture();for(let i=0;i<205;i++)state.messages.push({id:`m-${i}`,conversationId:state.activeConversationId,role:"user",content:`synthetic ${i}`,createdAt:new Date(1700000000000+i).toISOString()});bootstrap(state);
    expect(JSON.parse(store.get("state:u")!).state.messages).toEqual([]);expect(read().state.messages).toHaveLength(200);const page=store.transcriptPage("u",undefined,50);expect(page.messages).toHaveLength(50);const older=store.transcriptPage("u",page.cursor,50);expect(new Set([...page.messages,...older.messages].map(m=>m.id)).size).toBe(100);expect(store.transcriptPage("someone-else").messages).toEqual([]);expect(store.exportAccountState("u")!.state.messages).toHaveLength(205);
  });
  it("requires explicit renewed policy for legacy consent evidence",()=>{
    const state=fixture();store.put("account:u",JSON.stringify({id:"u"}));store.put("state:u",JSON.stringify(state));expect(read().revision).toBe(1);expect(JSON.parse(store.get("account-policy:u")!).termsVersion).toBe("legacy-self-declaration");atomic(()=>store.acceptPolicy("u",{aiProcessingConsent:true,memoryEnabled:true,conversationStorageEnabled:true},1));expect(JSON.parse(store.get("account-policy:u")!).termsVersion).toBe("2026-09-13");
  });
  it("bounds cumulative multilingual transcript bytes and rolls back the over-limit write",()=>{
    bootstrap();let current=read();let failed=false;
    for(let batch=0;batch<20;batch++){
      const messages=Array.from({length:40},(_,index)=>({id:`bytes-${batch}-${index}`,conversationId:current.state.activeConversationId,role:"user" as const,content:"ह".repeat(7900),createdAt:new Date(1700000000000+batch*40+index).toISOString()}));
      try{atomic(()=>store.saveAccountState("u",{...current.state,messages},current.revision));current=read();}
      catch(error){expect(String(error)).toContain("TRANSCRIPT_LIMIT");failed=true;break;}
    }
    expect(failed).toBe(true);expect(read().revision).toBe(current.revision);
    const exported=store.exportAccountState("u")!;
    expect(new TextEncoder().encode(JSON.stringify(exported)).byteLength).toBeLessThan(9_000_000);
    expect(exported.state.messages.length).toBeGreaterThan(200);
  });
  it("migrates legacy deleted-memory rows into content-free suppression",()=>{
    const state=fixture();state.memories=[{...initialState.memories[0]!,status:"deleted",content:"Synthetic legacy forgotten secret"}];store.put("account:u",'{"id":"u"}');store.put("state:u",JSON.stringify(state));expect(read().state.memories).toEqual([]);expect(store.get("state:u")).not.toContain("Synthetic legacy forgotten secret");expect(db.prepare("SELECT id FROM memory_suppressions WHERE user_id='u'").all()).toEqual([{id:state.memories[0]!.id}]);
  });
});

describe("memory erasure and history suppression",()=>{
  it("forget removes content from state, snapshots, derived reflections and exports; stale writes cannot restore it",()=>{
    bootstrap();atomic(()=>store.memoryCommand("u",{action:"create",content:"Synthetic forgotten secret"},1));const before=read();const id=before.state.memories[0]!.id;
    atomic(()=>store.memoryCommand("u",{action:"forget",id},2));expect(JSON.stringify(store.exportAccountState("u"))).not.toContain("Synthetic forgotten secret");expect(store.list("backup:u:")).toEqual([]);expect(atomic(()=>store.saveAccountState("u",before.state,2))).toMatchObject({conflict:true});
    atomic(()=>store.saveAccountState("u",before.state,3));expect(read().state.memories).toEqual([]);expect(db.prepare("SELECT * FROM memory_suppressions").all()).toEqual([expect.objectContaining({user_id:"u",id,forgotten_at:expect.any(Number)})]);
  });
  it("retains a source transcript explicitly; forgetting memory is not a transcript deletion promise",()=>{
    const state=fixture();state.messages=[{id:"m",conversationId:state.activeConversationId,role:"user",content:"Synthetic source text",createdAt:new Date().toISOString()}];bootstrap(state);atomic(()=>store.memoryCommand("u",{action:"create",content:"Synthetic source text"},1));const id=read().state.memories[0]!.id;atomic(()=>store.memoryCommand("u",{action:"forget",id},2));expect(store.exportAccountState("u")!.state.messages[0]!.content).toBe("Synthetic source text");
  });
  it("paused memories remain editable and deletable but cannot be created",()=>{
    bootstrap();atomic(()=>store.memoryCommand("u",{action:"create",content:"Synthetic note"},1));const current=read(),id=current.state.memories[0]!.id;current.state.memoryEnabled=false;atomic(()=>store.saveAccountState("u",current.state,2));expect(atomic(()=>store.memoryCommand("u",{action:"create",content:"blocked"},3))).toMatchObject({consentRequired:true});atomic(()=>store.memoryCommand("u",{action:"edit",id,content:"Synthetic corrected note"},3));expect(read().state.memories[0]!.content).toBe("Synthetic corrected note");atomic(()=>store.memoryCommand("u",{action:"forget",id},4));expect(read().state.memories).toEqual([]);
  });
  it("disabling history removes separate transcripts and old snapshots before responding",()=>{
    const state=fixture();state.messages=[{...initialState.messages[0]!,content:"Synthetic private history"}];bootstrap(state);const current=read();current.state.conversationStorageEnabled=false;atomic(()=>store.saveAccountState("u",current.state,1));expect(store.exportAccountState("u")!.state.messages).toEqual([]);expect(store.list("backup:u:")).toEqual([]);const stale={...current.state,conversationStorageEnabled:true};expect(atomic(()=>store.saveAccountState("u",stale,1))).toMatchObject({conflict:true});
  });
  it("account deletion fences session/state/migration writes and erases separate records",()=>{
    bootstrap();atomic(()=>store.memoryCommand("u",{action:"create",content:"Synthetic private note"},1));const current=read();atomic(()=>store.eraseAccount("u","u",[]));expect(store.readAccountState("u")).toBeNull();expect(store.exportAccountState("u")).toBeNull();expect(atomic(()=>store.saveAccountState("u",current.state,2))).toEqual({missing:true});expect(()=>store.put("session:late",JSON.stringify({userId:"u"}))).toThrow("deleted");expect(db.prepare("SELECT * FROM transcripts").all()).toEqual([]);
  });
  it("replaying an old state alongside retained suppression excludes forgotten memories",()=>{
    bootstrap();atomic(()=>store.memoryCommand("u",{action:"create",content:"Synthetic erased note"},1));const old=store.get("state:u")!;const id=read().state.memories[0]!.id;atomic(()=>store.memoryCommand("u",{action:"forget",id},2));store.put("state:u",old);expect(read().state.memories).toEqual([]);
  });
});

describe("reserved provider capacity",()=>{
  it("counts attempts and units while preserving account headroom from demo",()=>{
    for(let i=0;i<4;i++){const attemptId=`demo-${i}`;expect(reserve({tier:"demo",principal:"demo:1",attemptId})).toMatchObject({allowed:true});store.inferenceRelease(attemptId);}
    expect(reserve({tier:"demo",principal:"demo:2"})).toMatchObject({allowed:false,reason:"daily"});expect(reserve()).toMatchObject({allowed:true});
  });
  it("does not allow large demo requests to exhaust reserved unit capacity",()=>{expect(reserve({tier:"demo",units:41})).toMatchObject({allowed:false,reason:"daily"});expect(reserve({units:90})).toMatchObject({allowed:true});});
  it("releases leases without refunding cost and expires orphaned requests",()=>{
    vi.useFakeTimers();expect(reserve({attemptId:"a"})).toMatchObject({allowed:true});expect(reserve({attemptId:"b"})).toMatchObject({allowed:true});expect(reserve({attemptId:"c"})).toMatchObject({allowed:false,reason:"concurrency"});store.inferenceRelease("a");expect(reserve({attemptId:"c"})).toMatchObject({allowed:true});vi.advanceTimersByTime(41_000);expect(reserve()).toMatchObject({allowed:true});expect(store.capacity()[0]!.count).toBe(4);
  });
  it("daily exhaustion reports midnight not a misleading one minute retry",()=>{vi.useFakeTimers();vi.setSystemTime(new Date("2026-09-13T12:00:00Z"));expect(reserve({max:0})).toMatchObject({allowed:false,reason:"daily",retryAfter:43_200});});
});
