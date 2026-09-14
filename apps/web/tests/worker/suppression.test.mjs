import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { cleanupWorkerState } from "./cleanup.mjs";
import { SuppressionAuthorityEngine } from "../../lib/suppression-authority.ts";
import { SourceSuppressionReplicator } from "../../lib/suppression-replication.ts";
import { genesisCheckpoint } from "../../lib/suppression-protocol.ts";
import { freshDemo } from "../../lib/demo-storage.ts";

const source=()=>env.MIRA_STORE.get(env.MIRA_STORE.idFromName("mira-production-v1"));
const authority=()=>env.MIRA_STORE.get(env.MIRA_STORE.idFromName("mira-synthetic-suppression-authority"));
const authorityId="synthetic-separate-sqlite-authority";
beforeEach(()=>vi.stubGlobal("fetch",vi.fn(async()=>{throw Error("External network forbidden in suppression integration test");})));
afterEach(async()=>{await cleanupWorkerState();vi.unstubAllGlobals();});
async function action(data){const response=await source().fetch("https://store.internal/",{method:"POST",body:JSON.stringify(data)});return {status:response.status,body:await response.json()};}
async function seed(){
  const state=freshDemo();state.user.adultConfirmed=true;state.messages=[];state.memories=[];state.companionReflections=[];state.memoryEnabled=true;
  const result=await action({action:"bootstrap",key:"email:synthetic-adult",account:{id:"synthetic-adult"},state,sessionKey:"session:synthetic",sessionValue:'{"userId":"synthetic-adult"}',ttl:3600});
  expect(result.status).toBe(200);expect(result.body.created).toBe(true);return result.body;
}
async function protect(){
  const identity=await runInDurableObject(source(),instance=>instance.backup.source());
  const receipt=await runInDurableObject(authority(),(instance,ctx)=>{
    instance.__authority=new SuppressionAuthorityEngine(ctx.storage.sql,work=>ctx.storage.transactionSync(work),authorityId);
    return instance.__authority.enroll(identity,"synthetic-worker-writer");
  });
  const writer={authorityId,source:identity,writerId:receipt.writerId,epoch:receipt.epoch};
  await runInDurableObject(source(),async(instance,ctx)=>{
    instance.__requests=[];
    instance.replication=new SourceSuppressionReplicator(ctx.storage.sql,work=>ctx.storage.transactionSync(work),identity,()=>instance.__missingTransport?undefined:{authorityId,async append(request){
      instance.__requests.push(structuredClone(request));
      if(instance.__offline)throw Error("synthetic authority unavailable");
      const response=await runInDurableObject(authority(),remote=>remote.__authority.append(request));
      if(instance.__dropDeletionReceipt&&request.entries.some(entry=>entry.event.kind==="account")){instance.__dropDeletionReceipt=false;throw Error("synthetic committed receipt lost");}
      return response;
    }});
    await instance.replication.beginProtection(writer);await instance.replication.flush();
  });
  return writer;
}
async function remoteJournal(writer){return runInDurableObject(authority(),async instance=>instance.__authority.read(writer,await genesisCheckpoint(writer)));}

describe("actual MiraStore suppression response boundary",()=>{
  it("returns 503 for an unacknowledged deletion, retains its tombstone, then retries independently before any normal response",async()=>{
    await seed();const writer=await protect();
    await runInDurableObject(source(),instance=>{instance.__dropDeletionReceipt=true;});
    const deletion=await action({action:"eraseAccount",userId:"synthetic-adult",emailKey:"synthetic-adult"});
    expect(deletion).toMatchObject({status:503,body:{code:"SUPPRESSION_ACK_PENDING"}});
    await runInDurableObject(source(),instance=>{expect(instance.engine.get("account:synthetic-adult")).toBeNull();expect(instance.replication.status()).toMatchObject({acknowledgedSequence:1,pending:1});});
    expect((await remoteJournal(writer)).entries.map(entry=>entry.event.kind)).toEqual(["privacy","account"]);
    const retried=await action({action:"get",key:"account:synthetic-adult"});expect(retried).toEqual({status:200,body:{value:null}});
    await runInDurableObject(source(),instance=>{expect(instance.replication.status()).toMatchObject({acknowledgedSequence:2,pending:0});});
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not mutate or report success when transport disappears and does not downgrade on an object restart",async()=>{
    await seed();await protect();
    await runInDurableObject(source(),instance=>{instance.__missingTransport=true;});
    expect((await action({action:"memoryCommand",userId:"synthetic-adult",revision:1,command:{action:"create",content:"Synthetic blocked note"}})).body.code).toBe("SUPPRESSION_AUTHORITY_UNAVAILABLE");
    await runInDurableObject(source(),(instance,ctx)=>{
      // Reconstruct the production adapter with its unconfigured environment.
      instance.replication=new SourceSuppressionReplicator(ctx.storage.sql,work=>ctx.storage.transactionSync(work),instance.backup.source(),()=>undefined);
      expect(instance.engine.readAccountState("synthetic-adult").revision).toBe(1);
    });
    expect((await action({action:"get",key:"account:synthetic-adult"})).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("covers memory corrections, conversation deletion, withdrawal and re-enabling with only minimal independent events",async()=>{
    const seeded=await seed();const writer=await protect();
    const memory=await action({action:"memoryCommand",userId:"synthetic-adult",revision:1,command:{action:"create",content:"Synthetic private note"}});
    expect(memory.status).toBe(200);const id=memory.body.state.memories[0].id;
    for(const data of [
      {action:"memoryCommand",revision:2,command:{action:"edit",id,content:"Synthetic corrected note"}},
      {action:"memoryCommand",revision:3,command:{action:"forget",id}},
      {action:"conversationCommand",revision:4,command:{action:"delete",id:seeded.state.activeConversationId}},
      {action:"acceptPolicy",revision:5,policy:{aiProcessingConsent:false,memoryEnabled:false,conversationStorageEnabled:false}},
      {action:"acceptPolicy",revision:6,policy:{aiProcessingConsent:true,memoryEnabled:true,conversationStorageEnabled:true}},
    ])expect((await action({...data,userId:"synthetic-adult"})).status).toBe(200);
    const page=await remoteJournal(writer);expect(page.entries.map(entry=>entry.event.kind)).toEqual(["privacy","memory","memory","conversation","privacy","privacy"]);
    expect(JSON.stringify(page)).not.toContain("Synthetic private");expect(JSON.stringify(page)).not.toContain("Synthetic corrected");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("denies raw archived-data writes and legacy cutover even when a valid old backup key exists",async()=>{
    await seed();await protect();
    for(const data of [{action:"put",key:"state:synthetic-adult",value:"{}"},{action:"delete",key:"account:synthetic-adult"}])expect((await action(data)).body.code).toBe("SUPPRESSION_TYPED_ACTION_REQUIRED");
    await runInDurableObject(source(),instance=>{instance.env.MIRA_BACKUP_KEY=btoa("x".repeat(32));instance.env.MIRA_BACKUP_KEY_ID="synthetic-backup-key";});
    expect((await action({action:"backup",operation:"begin"})).body.code).toBe("SUPPRESSION_RECOVERY_ADMISSION_REQUIRED");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("honors a permanent writer fence on empty read barriers and scheduled work",async()=>{
    await seed();const writer=await protect();
    await runInDurableObject(authority(),instance=>instance.__authority.fence(writer,"mira-recovery-synthetic-target","synthetic-challenge"));
    expect((await action({action:"stateRead",userId:"synthetic-adult"})).body.code).toBe("SUPPRESSION_ACK_PENDING");
    await runInDurableObject(source(),async instance=>{await instance.alarm();expect(instance.engine.get("ops:cleanup-at")).toBeNull();});
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects a legacy KV read that began before protection but resolves after it",async()=>{
    await seed();
    await runInDurableObject(source(),instance=>{
      instance.__realLegacy=instance.env.LUMA_ACCOUNTS;
      instance.env.LUMA_ACCOUNTS={get:()=>new Promise(resolve=>{instance.__releaseLegacy=resolve;instance.__legacyStarted=true;}),delete:async()=>{},list:async()=>({keys:[],list_complete:true})};
    });
    const stale=action({action:"get",key:"account:stale-legacy-user"});
    await vi.waitFor(async()=>expect(await runInDurableObject(source(),instance=>instance.__legacyStarted)).toBe(true));
    await protect();
    await runInDurableObject(source(),instance=>instance.__releaseLegacy('{"id":"stale-legacy-user"}'));
    expect(await stale).toEqual({status:200,body:{value:null}});
    await runInDurableObject(source(),instance=>expect(instance.engine.row("account:stale-legacy-user")).toBeUndefined());
    expect(fetch).not.toHaveBeenCalled();
  });
});
