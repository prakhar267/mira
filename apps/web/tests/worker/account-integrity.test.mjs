import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {env} from "cloudflare:workers";
import {SELF,runInDurableObject,runDurableObjectAlarm} from "cloudflare:test";
import {cleanupWorkerState} from "./cleanup.mjs";
import {initialState} from "../../lib/state.ts";
import {sha256} from "../../lib/account-server.ts";

const origin="http://localhost:4173",password="Synthetic-password-1234!";
beforeEach(()=>{vi.stubGlobal("fetch",vi.fn(async()=>{throw new Error("External network forbidden in synthetic Worker tests");}));});
afterEach(async()=>{await cleanupWorkerState();vi.unstubAllGlobals();});
const stub=()=>env.MIRA_STORE.get(env.MIRA_STORE.idFromName("mira-production-v1"));
async function action(data,target=stub()){return (await target.fetch("https://store.internal/",{method:"POST",body:JSON.stringify(data)})).json();}
async function request(path,{method="GET",body,cookie,ip="192.0.2.1"}={}){const response=await SELF.fetch(`${origin}${path}`,{method,headers:{origin,"content-type":"application/json","cf-connecting-ip":ip,...cookie?{cookie}:{}},...body!==undefined?{body:JSON.stringify(body)}:{}});return new Response(await response.arrayBuffer(),{status:response.status,headers:response.headers});}
function fixture(){const state=structuredClone(initialState);state.user.name="Synthetic adult";state.user.interests=["synthetic testing"];state.messages=[];state.memories=[];state.calls=[];state.moments=[];state.companionReflections=[];state.futureEvents=[];state.nudges=[];state.companionBackstory="Synthetic companion test";return state;}
async function signup(index=1,state=fixture()){const response=await request("/api/account/signup",{method:"POST",ip:`192.0.2.${index}`,body:{email:`synthetic-${index}@example.test`,password,name:"Synthetic adult",state,policy:{termsVersion:"2026-09-13",adultConfirmed:true,aiProcessingConsent:true}}});const body=await response.json();expect(response.status,JSON.stringify(body)).toBe(201);return {...body,cookie:response.headers.get("set-cookie").split(";")[0]};}
async function current(user){const response=await request("/api/account/state",{cookie:user.cookie});expect(response.status).toBe(200);return response.json();}

describe("account routes with real Worker SQLite",()=>{
  it("creates a complete account and preserves old-password login compatibility",async()=>{
    const user=await signup();expect(user.revision).toBe(1);expect(user.state.user.id).toBe(user.account.id);expect(user.state.subscription.planId).toBe("free");
    const login=await request("/api/account/login",{method:"POST",body:{email:"synthetic-1@example.test",password}});expect(login.status).toBe(200);
    const record=JSON.parse((await action({action:"get",key:`account:${user.account.id}`})).value);delete record.passwordAlgorithm;delete record.passwordIterations;await action({action:"put",key:`account:${user.account.id}`,value:JSON.stringify(record)});
    expect((await request("/api/account/login",{method:"POST",body:{email:"synthetic-1@example.test",password}})).status).toBe(200);
    expect((await request("/api/account/login",{method:"POST",body:{email:"absent@example.test",password}})).status).toBe(401);
  });
  it("one concurrent save wins and the other receives an explicit owner-scoped conflict",async()=>{
    const user=await signup();const first={...user.state,user:{...user.state.user,name:"Synthetic first"}},second={...user.state,user:{...user.state.user,name:"Synthetic second"}};
    const responses=await Promise.all([first,second].map(state=>request("/api/account/state",{method:"PUT",cookie:user.cookie,body:{state,revision:user.revision}})));
    expect(responses.map(result=>result.status).sort()).toEqual([200,409]);const conflict=await responses.find(result=>result.status===409).json();expect(conflict).toMatchObject({code:"STATE_CONFLICT",revision:2});
    expect((await request("/api/account/state",{method:"PUT",cookie:user.cookie,body:{state:first}})).status).toBe(428);
    expect((await request("/api/account/state",{method:"PUT",cookie:user.cookie,body:{state:{...first,companionBackstory:"x".repeat(8001)},revision:2}})).status).toBe(400);
  });
  it("forgets memory on the server, exports without forgotten content and rejects stale resurrection",async()=>{
    const user=await signup();const created=await (await request("/api/account/memory",{method:"POST",cookie:user.cookie,body:{command:{action:"create",content:"Synthetic memory to erase"},revision:1}})).json();const id=created.state.memories[0].id;
    const forgotten=await request("/api/account/memory",{method:"POST",cookie:user.cookie,body:{command:{action:"forget",id},revision:created.revision}});expect(forgotten.status).toBe(200);
    const exported=await request("/api/account/export",{cookie:user.cookie});expect(exported.status).toBe(200);expect(await exported.text()).not.toContain("Synthetic memory to erase");
    const late=await request("/api/account/state",{method:"PUT",cookie:user.cookie,body:{state:created.state,revision:created.revision}});expect(late.status).toBe(409);
    const latest=await current(user);const forged=await request("/api/account/state",{method:"PUT",cookie:user.cookie,body:{state:created.state,revision:latest.revision}});expect(forged.status).toBe(200);expect((await current(user)).state.memories).toEqual([]);
  });
  it("requires recent password reauthentication before export and deletion",async()=>{
    const user=await signup(),token=user.cookie.split("=")[1],tokenHash=await sha256(token);const sessionKey=`session:${tokenHash}`;
    const session=JSON.parse((await action({action:"get",key:sessionKey})).value);session.reauthenticatedAt=new Date(Date.now()-11*60_000).toISOString();await action({action:"put",key:sessionKey,value:JSON.stringify(session),ttl:86400});
    expect((await request("/api/account/export",{cookie:user.cookie})).status).toBe(403);expect((await request("/api/account/delete",{method:"DELETE",cookie:user.cookie})).status).toBe(403);
    expect((await request("/api/account/reauth",{method:"POST",cookie:user.cookie,body:{password:"incorrect password"}})).status).toBe(401);
    expect((await request("/api/account/reauth",{method:"POST",cookie:user.cookie,body:{password}})).status).toBe(200);
    expect((await request("/api/account/export",{cookie:user.cookie})).status).toBe(200);
    expect((await request("/api/account/delete",{method:"DELETE",cookie:user.cookie})).status).toBe(200);expect((await request("/api/account/state",{cookie:user.cookie})).status).toBe(401);
    expect((await action({action:"stateSave",userId:user.account.id,state:user.state,revision:1}))).toEqual({missing:true});
  });
  it("creates and deletes server-owned conversations without collapsing history",async()=>{
    const user=await signup();let state=user.state;state.messages=[{id:"synthetic-message",conversationId:state.activeConversationId,role:"user",content:"Synthetic transcript",createdAt:new Date().toISOString()}];await request("/api/account/state",{method:"PUT",cookie:user.cookie,body:{state,revision:1}});
    const firstId=state.activeConversationId;const created=await (await request("/api/account/conversation",{method:"POST",cookie:user.cookie,body:{command:{action:"create"},revision:2}})).json();expect(created.state.activeConversationId).not.toBe(firstId);expect(created.state.messages[0].conversationId).toBe(firstId);
    const deleted=await request("/api/account/conversation",{method:"POST",cookie:user.cookie,body:{command:{action:"delete",id:firstId},revision:3}});expect(deleted.status).toBe(200);expect((await (await request(`/api/account/messages?conversationId=${firstId}`,{cookie:user.cookie})).json()).messages).toEqual([]);
    const late=await request("/api/account/state",{method:"PUT",cookie:user.cookie,body:{state,revision:4}});expect(late.status).toBe(409);
  });
  it("withdraws storage consent atomically and requires renewed policy for migrated accounts",async()=>{
    const user=await signup();await action({action:"put",key:`account-policy:${user.account.id}`,value:JSON.stringify({termsVersion:"legacy-self-declaration"})});const loaded=await current(user);expect(loaded.policy.termsVersion).toBe("legacy-self-declaration");
    const confirmed=await request("/api/account/policy",{method:"POST",cookie:user.cookie,body:{termsVersion:"2026-09-13",adultConfirmed:true,aiProcessingConsent:false,memoryEnabled:false,conversationStorageEnabled:false,revision:1}});expect(confirmed.status).toBe(200);const result=await current(user);expect(result.state.aiProcessingConsent).toBe(false);expect(result.policy.termsVersion).toBe("2026-09-13");expect(result.state.messages).toEqual([]);
  });
});

describe("migration scheduling and isolated logical recovery",()=>{
  it("does not hold unrelated requests behind a slow legacy read; a newer write wins",async()=>{
    const target=stub();
    await runInDurableObject(target,(instance)=>{instance.__realLegacy=instance.env.LUMA_ACCOUNTS;instance.env.LUMA_ACCOUNTS={get:()=>new Promise(resolve=>{instance.__releaseLegacy=resolve;instance.__legacyStarted=true;}),delete:async()=>{},list:async()=>({keys:[],list_complete:true})};});
    const stale=action({action:"get",key:"support:slow"},target);await vi.waitFor(async()=>expect(await runInDurableObject(target,instance=>instance.__legacyStarted)).toBe(true));
    const fast=await Promise.race([action({action:"put",key:"support:slow",value:'{"newer":true}'},target),new Promise(resolve=>setTimeout(()=>resolve({timedOut:true}),500))]);expect(fast).toEqual({ok:true});await runInDurableObject(target,instance=>instance.__releaseLegacy('{"older":true}'));expect(await stale).toEqual({value:'{"newer":true}'});
  });
  it("rechecks account deletion after an in-flight legacy import and runs bounded cleanup alarm",async()=>{
    const user=await signup();
    // Remain inside legacy retention without colliding with the daily snapshot
    // signup creates today. A fixed date silently stopped this race on that day.
    const backupKey=`backup:${user.account.id}:${new Date(Date.now()-7*86400000).toISOString().slice(0,10)}`;
    expect(await runInDurableObject(stub(),(_instance,ctx)=>ctx.storage.sql.exec("SELECT key FROM records WHERE key=?",backupKey).toArray())).toEqual([]);
    await runInDurableObject(stub(),instance=>{instance.__realLegacy=instance.env.LUMA_ACCOUNTS;instance.env.LUMA_ACCOUNTS={get:()=>new Promise(resolve=>{instance.__releaseLegacy=resolve;instance.__legacyStarted=true;}),delete:async()=>{},list:async()=>({keys:[],list_complete:true})};});
    const stale=action({action:"get",key:backupKey});await vi.waitFor(async()=>expect(await runInDurableObject(stub(),instance=>instance.__legacyStarted)).toBe(true));
    await action({action:"eraseAccount",userId:user.account.id,emailKey:await sha256("synthetic-1@example.test"),keys:[]});await runInDurableObject(stub(),instance=>instance.__releaseLegacy(JSON.stringify(user.state)));expect(await stale).toEqual({value:null});
    expect(await runDurableObjectAlarm(stub())).toBe(true);expect((await action({action:"list",prefix:"purge:"})).keys).toEqual([]);
  });
  it("restores synthetic account-shaped SQLite rows only after replaying post-backup deletion suppression",async()=>{
    const input=fixture();input.messages=[{id:"synthetic-restored-transcript",conversationId:input.activeConversationId,role:"user",content:"Synthetic transcript to suppress",createdAt:new Date().toISOString()}];
    const user=await signup(1,input);const created=await (await request("/api/account/memory",{method:"POST",cookie:user.cookie,body:{command:{action:"create",content:"Synthetic restore-only secret"},revision:1}})).json();
    const snapshot=await runInDurableObject(stub(),(_instance,ctx)=>({records:ctx.storage.sql.exec("SELECT * FROM records").toArray(),transcripts:ctx.storage.sql.exec("SELECT * FROM transcripts").toArray(),conversations:ctx.storage.sql.exec("SELECT * FROM account_conversations").toArray()}));
    const id=created.state.memories[0].id;await request("/api/account/memory",{method:"POST",cookie:user.cookie,body:{command:{action:"forget",id},revision:2}});
    await request("/api/account/policy",{method:"POST",cookie:user.cookie,body:{termsVersion:"2026-09-13",adultConfirmed:true,aiProcessingConsent:false,memoryEnabled:false,conversationStorageEnabled:false,revision:3}});
    const suppressions=await runInDurableObject(stub(),(_instance,ctx)=>ctx.storage.sql.exec("SELECT * FROM memory_suppressions").toArray());
    const privacy=await runInDurableObject(stub(),(_instance,ctx)=>ctx.storage.sql.exec("SELECT * FROM privacy_suppressions").toArray());
    const recovery=env.MIRA_STORE.get(env.MIRA_STORE.idFromName("isolated-account-logical-restore"));
    await runInDurableObject(recovery,(_instance,ctx)=>{ctx.storage.transactionSync(()=>{for(const row of snapshot.records)ctx.storage.sql.exec("INSERT OR REPLACE INTO records(key,value,expires,deleted) VALUES(?,?,?,?)",row.key,row.value,row.expires,row.deleted);for(const row of snapshot.transcripts)ctx.storage.sql.exec("INSERT INTO transcripts(user_id,id,created_at,value) VALUES(?,?,?,?)",row.user_id,row.id,row.created_at,row.value);for(const row of snapshot.conversations)ctx.storage.sql.exec("INSERT INTO account_conversations(user_id,id,deleted) VALUES(?,?,?)",row.user_id,row.id,row.deleted);for(const row of suppressions)ctx.storage.sql.exec("INSERT INTO memory_suppressions(user_id,id,forgotten_at) VALUES(?,?,?)",row.user_id,row.id,row.forgotten_at);for(const row of privacy)ctx.storage.sql.exec("INSERT INTO privacy_suppressions(user_id,revision,ai_disabled,history_disabled,memory_disabled) VALUES(?,?,?,?,?)",row.user_id,row.revision,row.ai_disabled,row.history_disabled,row.memory_disabled);});});
    const restored=await action({action:"stateExport",userId:user.account.id},recovery);expect(JSON.stringify(restored)).not.toContain("Synthetic restore-only secret");expect(restored.envelope.state.messages).toEqual([]);expect(restored.envelope.state.aiProcessingConsent).toBe(false);
    const physical=await runInDurableObject(recovery,(_instance,ctx)=>JSON.stringify(ctx.storage.sql.exec("SELECT value FROM records WHERE deleted=0").toArray()));expect(physical).not.toContain("Synthetic restore-only secret");
    await action({action:"eraseAccount",userId:user.account.id,emailKey:await sha256("synthetic-1@example.test"),keys:[]});
    const deletionFence=await runInDurableObject(stub(),(_instance,ctx)=>ctx.storage.sql.exec("SELECT * FROM records WHERE deleted=1").toArray());
    await runInDurableObject(recovery,(_instance,ctx)=>{ctx.storage.transactionSync(()=>{for(const row of deletionFence)ctx.storage.sql.exec("INSERT OR REPLACE INTO records(key,value,expires,deleted) VALUES(?,NULL,NULL,1)",row.key);ctx.storage.sql.exec("DELETE FROM transcripts WHERE user_id=?",user.account.id);});});
    expect(await action({action:"stateRead",userId:user.account.id},recovery)).toEqual({envelope:null});
  });
  it("measures a synthetic mixed storage workload rather than a health-only endpoint",async()=>{
    const users=await Promise.all([1,2,3,4].map(index=>{const state=fixture();state.messages=Array.from({length:1500},(_,i)=>({id:`synthetic-${index}-${i}`,conversationId:state.activeConversationId,role:"user",content:`Synthetic workload turn ${i}, no real conversation data.`,createdAt:new Date(1700000000000+i).toISOString()}));return signup(index,state);})),durations=[];let failures=0;const started=performance.now();
    const run=async(operation)=>{const at=performance.now();try{await operation();}catch(error){failures++;throw error;}finally{durations.push(performance.now()-at);}};
    await Promise.all(users.map(async user=>{for(let index=0;index<5;index++){await run(async()=>{const state=await current(user);const saved=await request("/api/account/state",{method:"PUT",cookie:user.cookie,body:{state:{...state.state,theme:index%2?"dark":"light"},revision:state.revision}});expect(saved.status).toBe(200);});await run(()=>action({action:"metric",name:"synthetic:save",duration:12,failed:false}));await run(()=>action({action:"put",key:`support:synthetic-${user.account.id}-${index}`,value:'{"synthetic":true}'}));await run(()=>action({action:"list",prefix:"support:",limit:10}));}}));
    durations.sort((a,b)=>a-b);const percentile=p=>Math.round(durations[Math.min(durations.length-1,Math.ceil(durations.length*p)-1)]*100)/100;
    const storage=await action({action:"storageStats"});
    console.log(JSON.stringify({evidence:"synthetic-mixed-worker-storage",accounts:4,operations:durations.length,failures,elapsedMs:Math.round(performance.now()-started),p50Ms:percentile(.5),p95Ms:percentile(.95),p99Ms:percentile(.99),storage,note:"Local workerd mixed state read+save, metrics, support write/list; no inference or physical-call capacity claim"}));expect(failures).toBe(0);
  });
});
