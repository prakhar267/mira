import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {env} from "cloudflare:workers";
import {SELF,runInDurableObject,evictAllDurableObjects} from "cloudflare:test";
import {cleanupWorkerState} from "./cleanup.mjs";
import {SuppressionAuthorityEngine} from "../../lib/suppression-authority.ts";
import {openBackup} from "../../lib/backup-crypto.ts";
import {genesisCheckpoint} from "../../lib/suppression-protocol.ts";
import {freshDemo} from "../../lib/demo-storage.ts";

const origin="http://localhost:4173",targetName="mira-recovery-protected-worker";
const object=name=>env.MIRA_STORE.get(env.MIRA_STORE.idFromName(name));
const source=()=>object("mira-production-v1"),target=()=>object(targetName),independent=()=>env.MIRA_AUTHORITY.get(env.MIRA_AUTHORITY.idFromName("mira-independent-authority-fixture"));
const key={keyId:"synthetic-v2",material:btoa("k".repeat(32))};
const configuration={MIRA_PROTECTED_RECOVERY_ENABLED:"true",MIRA_BACKUP_KEY:key.material,MIRA_BACKUP_KEY_ID:key.keyId,MIRA_SUPPRESSION_AUTHORITY_ID:"synthetic-independent-authority",MIRA_SUPPRESSION_AUTHORITY_URL:"https://synthetic-authority.example.test/",MIRA_SUPPRESSION_AUTHORITY_TOKEN:"s".repeat(40),MIRA_RECOVERY_AUTHORITY_TOKEN:"o".repeat(40)};
beforeEach(()=>vi.stubGlobal("fetch",vi.fn(async(url,init)=>{
  if(String(url)!==configuration.MIRA_SUPPRESSION_AUTHORITY_URL)throw Error("External network forbidden in v2 Worker tests");
  return independent().fetch(url,init);
})));
afterEach(async()=>{await cleanupWorkerState();vi.unstubAllGlobals();});
async function action(stub,data){const response=await stub.fetch("https://store.internal/",{method:"POST",body:JSON.stringify(data)});return {status:response.status,body:await response.json()};}
async function configure(stub){await runInDurableObject(stub,instance=>{instance.env={...instance.env,...configuration};});}
async function operation(stub,name,input){const result=await action(stub,{...input,action:"protectedRecovery",target:name});expect(result.status,JSON.stringify(result.body)).toBe(200);return result.body;}
async function setup(){
  const state=freshDemo();state.user.adultConfirmed=true;state.user.name="Synthetic V2 adult";state.memoryEnabled=true;
  const response=await SELF.fetch(`${origin}/api/account/signup`,{method:"POST",headers:{origin,"content-type":"application/json","cf-connecting-ip":"192.0.2.96"},body:JSON.stringify({email:"protected-worker@example.test",password:"Synthetic-password-1234!",name:state.user.name,state,policy:{termsVersion:"2026-09-13",adultConfirmed:true,aiProcessingConsent:true}})});
  const signup=await response.json();expect(response.status,JSON.stringify(signup)).toBe(201);
  const added=await action(source(),{action:"memoryCommand",userId:signup.account.id,revision:1,command:{action:"create",content:"Synthetic forget after v2 capture"}});expect(added.status).toBe(200);
  await configure(source());await configure(target());
  const call=data=>operation(source(),"mira-production-v1",data);
  await call({operation:"protect",writerId:"worker-generation",confirm:"ENABLE INDEPENDENT SUPPRESSION"});
  const job=await call({operation:"begin"}),chunks=[];
  for(let i=0;i<100;i++){const page=await call({operation:"page",archiveId:job.archiveId,nonce:job.nonce});if(page.done)break;chunks.push(page.sealed);}
  const archive=await call({operation:"finish",archiveId:job.archiveId,nonce:job.nonce});
  expect((await action(source(),{action:"memoryCommand",userId:signup.account.id,revision:2,command:{action:"forget",id:added.body.state.memories[0].id}})).status).toBe(200);
  return {signup,chunks,archive};
}
describe("actual Worker v2 protected recovery",()=>{
  it("uses authenticated authority HTTP transport, destroys source SQL, opens only after full replay, and protects new target deletion",async()=>{
    const f=await setup(),manifest=await openBackup(f.archive.sealed,"manifest",key);
    expect(manifest.version).toBe(2);
    await runInDurableObject(source(),async(_instance,ctx)=>{await ctx.storage.deleteAlarm();await ctx.storage.deleteAll();});
    await evictAllDurableObjects();await configure(target());
    const start=await operation(target(),targetName,{operation:"restoreBegin",sealed:f.archive.sealed});expect(start.complete).toBe(false);
    expect((await action(target(),{action:"stateRead",userId:f.signup.account.id,selectedTarget:targetName})).body.code).toBe("RECOVERY_TARGET_NOT_ADMITTED");
    for(const sealed of f.chunks)await operation(target(),targetName,{operation:"restoreChunk",sealed});
    let result;for(let i=0;i<10;i++){result=await operation(target(),targetName,{operation:"restoreStep"});if(result.complete)break;}
    expect(result).toMatchObject({mode:"active",complete:true,admission:{admitted:true}});
    const state=await action(target(),{action:"stateRead",userId:f.signup.account.id,selectedTarget:targetName});expect(state.status).toBe(200);expect(JSON.stringify(state.body)).not.toContain("Synthetic forget after v2 capture");
    const account=JSON.parse((await action(target(),{action:"get",key:`account:${f.signup.account.id}`,selectedTarget:targetName})).body.value);expect(account).toMatchObject({passwordResetRequired:true,recoveryVerificationRequired:true});
    const erased=await action(target(),{action:"eraseAccount",userId:f.signup.account.id,emailKey:account.emailKey,selectedTarget:targetName});expect(erased.status).toBe(200);
    const remote=await runInDurableObject(independent(),async(instance,ctx)=>new SuppressionAuthorityEngine(ctx.storage.sql,work=>ctx.storage.transactionSync(work),configuration.MIRA_SUPPRESSION_AUTHORITY_ID).read(result.successor,await genesisCheckpoint(result.successor)));
    expect(remote.entries.at(-1).event).toEqual({kind:"account",userId:f.signup.account.id});
    expect(fetch).toHaveBeenCalled();for(const [url] of fetch.mock.calls)expect(String(url)).toBe(configuration.MIRA_SUPPRESSION_AUTHORITY_URL);
  });
  it("denies a newly selected blank target, an invalid selector and an admission bound to another target",async()=>{
    const blank=object("mira-recovery-unused-target");
    expect((await action(blank,{action:"get",key:"account:any",selectedTarget:"mira-recovery-unused-target"})).body.code).toBe("RECOVERY_TARGET_NOT_ADMITTED");
    expect((await action(blank,{action:"get",key:"account:any",selectedTarget:"invalid"})).body.code).toBe("RECOVERY_TARGET_CONFIGURATION_INVALID");
    await runInDurableObject(blank,instance=>{instance.env={...instance.env,MIRA_STORE_OBJECT_NAME:"mira-recovery-unused-target"};});
    expect((await action(blank,{action:"get",key:"account:any"})).body.code).toBe("RECOVERY_TARGET_NOT_ADMITTED");
    expect((await action(blank,{action:"get",key:"account:any",selectedTarget:"mira-production-v1"})).body.code).toBe("RECOVERY_TARGET_CONFIGURATION_INVALID");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps v2 operator work disabled without explicit server activation and refuses unauthenticated public export",async()=>{
    const disabled=await action(source(),{action:"protectedRecovery",operation:"begin",target:"mira-production-v1"});expect(disabled).toMatchObject({status:503,body:{code:"RECOVERY_V2_DISABLED"}});
    const response=await SELF.fetch(`${origin}/api/admin/backup`,{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify({version:2,operation:"begin"})});
    expect(response.status).toBe(503);expect(await response.text()).toContain("Operator access is not configured");expect(fetch).not.toHaveBeenCalled();
  });
});
