import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {env} from "cloudflare:workers";
import {SELF,runInDurableObject} from "cloudflare:test";
import {cleanupWorkerState} from "./cleanup.mjs";
import {freshDemo} from "../../lib/demo-storage.ts";
import {openBackup} from "../../lib/backup-crypto.ts";

const origin="http://localhost:4173",targetName="mira-recovery-worker-encrypted";
const source=()=>env.MIRA_STORE.get(env.MIRA_STORE.idFromName("mira-production-v1"));
const target=()=>env.MIRA_STORE.get(env.MIRA_STORE.idFromName(targetName));
const key={keyId:"synthetic-worker-backup-v1",material:btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))};
beforeEach(()=>vi.stubGlobal("fetch",vi.fn(async()=>{throw Error("External network forbidden in encrypted recovery test");})));
afterEach(async()=>{await cleanupWorkerState();vi.unstubAllGlobals();});
async function action(stub,data){const response=await stub.fetch("https://store.internal/",{method:"POST",body:JSON.stringify(data)});return {status:response.status,body:await response.json()};}
async function backup(stub,data){const response=await action(stub,{action:"backup",...data});expect(response.status,JSON.stringify(response.body)).toBe(200);return response.body;}
async function configure(stub){await runInDurableObject(stub,instance=>{instance.env={...instance.env,MIRA_BACKUP_KEY:key.material,MIRA_BACKUP_KEY_ID:key.keyId};});}
async function archive(stub,kind="snapshot"){
  const job=await backup(stub,{operation:kind==="snapshot"?"begin":"ledger"}),chunks=[];
  for(let i=0;i<100;i++){const next=await backup(stub,{operation:"page",archiveId:job.archiveId,nonce:job.nonce});if(next.done)break;chunks.push(next.sealed);}
  const complete=await backup(stub,{operation:"finish",archiveId:job.archiveId,nonce:job.nonce});return {sealed:complete.sealed,manifest:await openBackup(complete.sealed,"manifest",key),chunks};
}
describe("encrypted backup boundaries in actual Worker SQLite",()=>{
  it("denies unconfigured public operator exports without sending data",async()=>{
    const response=await SELF.fetch(`${origin}/api/admin/backup`,{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify({operation:"begin"})});
    expect(response.status).toBe(503);expect(await response.text()).toContain("Operator access is not configured");expect(fetch).not.toHaveBeenCalled();
  });
  it("quarantines real storage, transfers authenticated chunks, replays newer memory deletion and invalidates old credentials",async()=>{
    const state=freshDemo();state.user.adultConfirmed=true;state.user.name="Synthetic recovery adult";state.memoryEnabled=true;
    state.messages=[{id:"synthetic-kept-transcript",conversationId:state.activeConversationId,role:"user",content:"Synthetic transcript that survives restore",createdAt:new Date().toISOString()}];
    const response=await SELF.fetch(`${origin}/api/account/signup`,{method:"POST",headers:{origin,"content-type":"application/json","cf-connecting-ip":"192.0.2.66"},body:JSON.stringify({email:"worker-recovery@example.test",password:"Synthetic-password-1234!",name:state.user.name,state,policy:{termsVersion:"2026-09-13",adultConfirmed:true,aiProcessingConsent:true}})});
    const user=await response.json();expect(response.status,JSON.stringify(user)).toBe(201);
    const added=await action(source(),{action:"memoryCommand",userId:user.account.id,revision:1,command:{action:"create",content:"Synthetic memory forgotten after encrypted archive"}});expect(added.status).toBe(200);
    await configure(source());await configure(target());const snapshot=await archive(source());
    expect(JSON.stringify(snapshot.chunks)).not.toContain("Synthetic memory");
    await action(source(),{action:"memoryCommand",userId:user.account.id,revision:2,command:{action:"forget",id:added.body.state.memories[0].id}});
    const start=await backup(target(),{operation:"restoreBegin",target:targetName,sealed:snapshot.sealed});
    const blocked=await action(target(),{action:"get",key:`account:${user.account.id}`});expect(blocked.status).toBe(503);expect(blocked.body.code).toBe("RECOVERY_MAINTENANCE");
    const proof=await backup(source(),{operation:"retire",destination:targetName,challenge:start.challenge,backupId:snapshot.manifest.archiveId,source:snapshot.manifest.source,confirm:"RETIRE mira-production-v1"});
    const ledger=await archive(source(),"ledger");
    await backup(target(),{operation:"restoreLedger",sealed:ledger.sealed});
    for(const chunk of [...snapshot.chunks,...ledger.chunks])await backup(target(),{operation:"restoreChunk",sealed:chunk});
    const complete=await backup(target(),{operation:"restoreFinalize",sealed:proof.sealed});expect(complete.complete).toBe(true);
    const exported=await action(target(),{action:"stateExport",userId:user.account.id});expect(exported.status).toBe(200);expect(exported.body.envelope.state.messages).toHaveLength(1);expect(JSON.stringify(exported.body)).not.toContain("Synthetic memory forgotten");
    const credential=await action(target(),{action:"get",key:`account:${user.account.id}`});expect(JSON.parse(credential.body.value)).toMatchObject({passwordResetRequired:true,recoveryVerificationRequired:true});
    const policy=await action(target(),{action:"acceptPolicy",userId:user.account.id,revision:exported.body.envelope.revision,policy:{aiProcessingConsent:true,memoryEnabled:true,conversationStorageEnabled:true}});expect(policy.status).toBe(403);expect(policy.body.code).toBe("ACCOUNT_VERIFICATION_REQUIRED");
    expect((await action(source(),{action:"get",key:`account:${user.account.id}`})).body.code).toBe("RECOVERY_MAINTENANCE");expect(fetch).not.toHaveBeenCalled();
  });
});
