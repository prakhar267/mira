import { DatabaseSync } from "node:sqlite";
import { copyFileSync, mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoreEngine, type SqlStorage } from "./store-engine";
import { RecoveryJournal } from "./recovery-journal";
import { SuppressionAuthorityEngine } from "./suppression-authority";
import { SourceSuppressionReplicator } from "./suppression-replication";
import { genesisCheckpoint, type AppendRequest, type SuppressionTransport, type Writer } from "./suppression-protocol";
import { initialState } from "./state";
import { suppressionTransport } from "./suppression-transport";

function database(path:string) {
  const db=new DatabaseSync(path);
  let inTransaction=false;
  const sql:SqlStorage={exec(query,...values){const rows=db.prepare(query).all(...values) as Record<string,unknown>[];return {toArray:()=>rows};}};
  const transaction=<T>(work:()=>T)=>{db.exec("BEGIN IMMEDIATE");inTransaction=true;try{const value=work();db.exec("COMMIT");return value;}catch(error){db.exec("ROLLBACK");throw error;}finally{inTransaction=false;}};
  return {db,sql,transaction,inTransaction:()=>inTransaction};
}
let directory:string,source:ReturnType<typeof database>|undefined,remote:ReturnType<typeof database>;
let store:StoreEngine,journal:RecoveryJournal,authority:SuppressionAuthorityEngine,replication:SourceSuppressionReplicator,writer:Writer,transport:SuppressionTransport|undefined;
const sourceId="synthetic-source",authorityId="synthetic-independent-authority";
const requests:AppendRequest[]=[];
beforeEach(async()=>{
  directory=mkdtempSync(join(tmpdir(),"mira-suppression-replication-"));
  source=database(join(directory,"source.sqlite"));remote=database(join(directory,"authority.sqlite"));
  store=new StoreEngine(source.sql);journal=new RecoveryJournal(source.sql);
  authority=new SuppressionAuthorityEngine(remote.sql,remote.transaction,authorityId);
  const enrolled=await authority.enroll(sourceId,"synthetic-writer");
  writer={authorityId,source:sourceId,writerId:enrolled.writerId,epoch:enrolled.epoch};
  requests.length=0;
  transport={authorityId,async append(request){expect(source!.inTransaction()).toBe(false);requests.push(structuredClone(request));return authority.append(request);}};
  replication=new SourceSuppressionReplicator(source.sql,source.transaction,sourceId,()=>transport);
});
afterEach(()=>{source?.db.close();remote.db.close();rmSync(directory,{recursive:true,force:true});vi.restoreAllMocks();});
function seed() {
  const state=structuredClone(initialState);state.messages=[];state.memories=[];state.companionReflections=[];state.calls=[];state.memoryEnabled=true;state.conversationStorageEnabled=true;state.aiProcessingConsent=true;
  return source!.transaction(()=>store.bootstrap("email:synthetic-adult",{id:"synthetic-adult"},state,"session:synthetic",'{"userId":"synthetic-adult"}',3600));
}
function read(){return store.readAccountState("synthetic-adult")!;}
async function protectedMutation<T>(work:()=>T) {await replication.flush();const result=source!.transaction(work);await replication.flush();return result;}

describe("durable independent acknowledgement of real account mutations",()=>{
  it("does nothing external before protection is durably provisioned",async()=>{
    transport=undefined;seed();await replication.flush();expect(replication.status()).toMatchObject({protected:false,acknowledgedSequence:null});expect(requests).toEqual([]);
  });
  it("replays from genesis, preserves the binding across restart, and cannot downgrade or change identity",async()=>{
    seed();await replication.beginProtection(writer);await replication.flush();
    replication=new SourceSuppressionReplicator(source!.sql,source!.transaction,sourceId,()=>transport);
    expect(replication.status()).toMatchObject({protected:true,acknowledgedSequence:1,pending:0});
    await replication.beginProtection(writer);expect(replication.status().acknowledgedSequence).toBe(1);
    await expect(replication.beginProtection({...writer,writerId:"other"})).rejects.toThrow("LOCKED");
    transport=undefined;await expect(replication.flush()).rejects.toThrow("UNAVAILABLE");
    transport={authorityId:"wrong-authority",append:vi.fn()};await expect(replication.flush()).rejects.toThrow("UNAVAILABLE");expect(transport.append).not.toHaveBeenCalled();
  });
  it("keeps account deletion local but refuses success until a lost independent receipt can be retried",async()=>{
    seed();await replication.beginProtection(writer);await replication.flush();
    let dropped=false;
    transport={authorityId,async append(request){const receipt=await authority.append(request);if(request.entries.some(entry=>entry.event.kind==="account")&&!dropped){dropped=true;throw Error("synthetic receipt lost after remote commit");}return receipt;}};
    await expect(protectedMutation(()=>store.eraseAccount("synthetic-adult","synthetic-adult",[]))).rejects.toThrow("ACK_PENDING");
    expect(store.get("account:synthetic-adult")).toBeNull();expect(replication.status()).toMatchObject({acknowledgedSequence:1,pending:1});
    replication=new SourceSuppressionReplicator(source!.sql,source!.transaction,sourceId,()=>transport);
    await replication.flush();expect(replication.status()).toMatchObject({acknowledgedSequence:2,pending:0});
    const page=authority.read(writer,await genesisCheckpoint(writer));
    expect(page.entries.map(entry=>entry.event.kind)).toEqual(["privacy","account"]);
  });
  it("retains acknowledged forget/correction/conversation/privacy/deletion events after the source file is lost",async()=>{
    seed();await replication.beginProtection(writer);await replication.flush();
    await protectedMutation(()=>store.memoryCommand("synthetic-adult",{action:"create",content:"Synthetic original private memory"},read().revision));
    const memoryId=read().state.memories[0]!.id;
    await protectedMutation(()=>store.memoryCommand("synthetic-adult",{action:"edit",id:memoryId,content:"Synthetic corrected private memory"},read().revision));
    await protectedMutation(()=>store.memoryCommand("synthetic-adult",{action:"forget",id:memoryId},read().revision));
    await protectedMutation(()=>store.conversationCommand("synthetic-adult",{action:"delete",id:read().state.activeConversationId},read().revision));
    await protectedMutation(()=>store.acceptPolicy("synthetic-adult",{aiProcessingConsent:false,memoryEnabled:false,conversationStorageEnabled:false},read().revision));
    await protectedMutation(()=>store.acceptPolicy("synthetic-adult",{aiProcessingConsent:true,memoryEnabled:true,conversationStorageEnabled:true},read().revision));
    await protectedMutation(()=>store.eraseAccount("synthetic-adult","synthetic-adult",[]));
    const acknowledged=replication.status().acknowledgedSequence;
    source!.db.close();source=undefined;unlinkSync(join(directory,"source.sqlite"));
    remote.db.close();remote=database(join(directory,"authority.sqlite"));authority=new SuppressionAuthorityEngine(remote.sql,remote.transaction,authorityId);
    const page=authority.read(writer,await genesisCheckpoint(writer));
    expect(page.head.sequence).toBe(acknowledged);expect(page.entries.map(entry=>entry.event.kind)).toEqual(["privacy","memory","memory","conversation","privacy","privacy","account"]);
    const encoded=JSON.stringify(page);for(const content of ["Synthetic original","Synthetic corrected","password","email:","session:"])expect(encoded).not.toContain(content);
    expect(page.entries[4]!.event).toMatchObject({kind:"privacy",history:false,ai:false,memory:false});
    // This proves durable journal retention, NOT successful recovery admission.
  });
  it("blocks local acknowledgement when an authority rejects the writer epoch",async()=>{
    seed();await replication.beginProtection(writer);await replication.flush();
    authority.fence(writer,"mira-recovery-synthetic-target","synthetic-challenge");
    await expect(protectedMutation(()=>store.eraseAccount("synthetic-adult","synthetic-adult",[]))).rejects.toThrow("ACK_PENDING");
    expect(store.get("account:synthetic-adult")).not.toBeNull();
  });
  it("does not acknowledge forged or cross-generation receipts",async()=>{
    seed();await replication.beginProtection(writer);
    transport={authorityId,async append(request){return {...await authority.append(request),writerId:"imposter"};}};
    await expect(replication.flush()).rejects.toThrow("RECEIPT_INVALID");expect(replication.status().acknowledgedSequence).toBe(0);
    transport={authorityId,async append(request){return {...await authority.append(request),sequence:99};}};
    await expect(replication.flush()).rejects.toThrow("RECEIPT_INVALID");expect(replication.status().acknowledgedSequence).toBe(0);
  });
  it("makes bounded durable progress through a backlog without premature success",async()=>{
    source!.transaction(()=>{for(let index=0;index<1030;index++)journal.append({kind:"memory",userId:"synthetic-adult",id:`forgotten-${index}`});});
    await replication.beginProtection(writer);await expect(replication.flush()).rejects.toThrow("BACKLOG_PENDING");
    expect(replication.status()).toMatchObject({acknowledgedSequence:1024,pending:6});await replication.flush();expect(replication.status()).toMatchObject({acknowledgedSequence:1030,pending:0});
  });
  it("serializes overlapping flushes and advances only through committed contiguous entries",async()=>{
    seed();await replication.beginProtection(writer);
    const first=replication.flush();source!.transaction(()=>journal.append({kind:"memory",userId:"synthetic-adult",id:"synthetic-forgotten"}));
    await Promise.all([first,replication.flush(),replication.flush()]);
    expect(replication.status()).toMatchObject({acknowledgedSequence:2,pending:0});expect(authority.read(writer,await genesisCheckpoint(writer)).entries).toHaveLength(2);
    expect(requests.some(request=>!request.entries.length)).toBe(true);
  });
  it("fails closed for missing sequences, corrupt durable mode and rolled-back source head",async()=>{
    source!.transaction(()=>{journal.append({kind:"account",userId:"a"});journal.append({kind:"account",userId:"b"});});
    await replication.beginProtection(writer);source!.sql.exec("DELETE FROM recovery_events WHERE seq=1");await expect(replication.flush()).rejects.toThrow("SEQUENCE_GAP");
    source!.sql.exec("INSERT INTO recovery_events(seq,value) VALUES(1,?)",JSON.stringify({kind:"account",userId:"a"}));await replication.flush();
    source!.sql.exec("DELETE FROM recovery_events WHERE seq=2");await expect(replication.flush()).rejects.toThrow("SOURCE_ROLLBACK");
    source!.sql.exec("UPDATE suppression_protection SET value=?",JSON.stringify({version:999}));expect(()=>replication.isProtected()).toThrow("PROTECTION_INVALID");
  });
  it("denies a physically rewound source even when its local journal and acknowledged checkpoint agree",async()=>{
    seed();source!.transaction(()=>store.memoryCommand("synthetic-adult",{action:"create",content:"Synthetic memory must stay forgotten"},read().revision));
    const memoryId=read().state.memories[0]!.id;
    await replication.beginProtection(writer);await replication.flush();
    const sourcePath=join(directory,"source.sqlite"),oldCopy=join(directory,"source-before-forget.sqlite");
    const reopen=()=>{source=database(sourcePath);store=new StoreEngine(source.sql);journal=new RecoveryJournal(source.sql);replication=new SourceSuppressionReplicator(source.sql,source.transaction,sourceId,()=>transport);};
    source!.db.close();source=undefined;copyFileSync(sourcePath,oldCopy);reopen();
    await protectedMutation(()=>store.memoryCommand("synthetic-adult",{action:"forget",id:memoryId},read().revision));
    expect(replication.status().acknowledgedSequence).toBe(2);
    source!.db.close();source=undefined;copyFileSync(oldCopy,sourcePath);reopen();
    expect(replication.status()).toMatchObject({journalSequence:1,acknowledgedSequence:1,pending:0});
    expect(store.get("state:synthetic-adult")).toContain("Synthetic memory must stay forgotten");
    await expect(protectedMutation(()=>store.readAccountState("synthetic-adult"))).rejects.toThrow("SUPPRESSION_SOURCE_ROLLBACK");
    expect(replication.status().acknowledgedSequence).toBe(1);
    expect(authority.read(writer,await genesisCheckpoint(writer)).entries[1]!.event).toEqual({kind:"memory",userId:"synthetic-adult",id:memoryId});
  });
  it("reconstructs through a newer remote head without skipping local events or treating a lost receipt as a source rollback",async()=>{
    seed();await replication.beginProtection(writer);
    let advanced=false;
    transport={authorityId,async append(request){
      if(!advanced){
        advanced=true;
        source!.transaction(()=>journal.append({kind:"memory",userId:"synthetic-adult",id:"concurrent-forget"}));
        // Another request persisted the full contiguous range, but its receipt
        // was not saved locally. The first request still ends at sequence 1.
        await authority.append({writer,after:await genesisCheckpoint(writer),entries:journal.page(0,2)});
      }
      return authority.append(request);
    }};
    await replication.flush();expect(replication.status()).toMatchObject({acknowledgedSequence:2,pending:0});
  });
  it("rejects missing, older or conflicting independent heads rather than trusting an old-format prefix receipt",async()=>{
    seed();await replication.beginProtection(writer);
    const genesis=await genesisCheckpoint(writer);
    transport={authorityId,async append(request){const accepted=await authority.append(request);return {...accepted,head:genesis};}};
    await expect(replication.flush()).rejects.toThrow("RECEIPT_INVALID");
    transport={authorityId,async append(request){const accepted=await authority.append(request);return {...accepted,head:{...accepted.head,digest:genesis.digest}};}};
    await expect(replication.flush()).rejects.toThrow("RECEIPT_INVALID");
    transport={authorityId,async append(request){const accepted=await authority.append(request);return {authorityId:accepted.authorityId,source:accepted.source,writerId:accepted.writerId,epoch:accepted.epoch,sequence:accepted.sequence,digest:accepted.digest};}};
    await expect(replication.flush()).rejects.toThrow("RECEIPT_INVALID");expect(replication.status().acknowledgedSequence).toBe(0);
  });
  it("journals legacy deleted memories during a read migration exactly once without their content",async()=>{
    const state=structuredClone(initialState);state.messages=[];state.memories=[{...initialState.memories[0]!,id:"legacy-forgotten",status:"deleted",content:"Synthetic legacy erased content"}];
    source!.transaction(()=>{store.put("account:synthetic-adult",'{"id":"synthetic-adult"}');store.put("state:synthetic-adult",JSON.stringify(state));});
    await replication.beginProtection(writer);await protectedMutation(()=>store.readAccountState("synthetic-adult"));await protectedMutation(()=>store.readAccountState("synthetic-adult"));
    const page=authority.read(writer,await genesisCheckpoint(writer));expect(page.entries.filter(entry=>entry.event.kind==="memory")).toHaveLength(1);expect(JSON.stringify(page)).not.toContain("Synthetic legacy erased content");
  });
  it("denies unjournaled raw account mutations and legacy recovery for protected sources",async()=>{
    await replication.beginProtection(writer);
    for(const key of ["account:u","state:u","account-policy:u","email:u","backup:u:2026-09-01"])expect(()=>replication.assertRawMutationAllowed(key)).toThrow("TYPED_ACTION_REQUIRED");
    expect(()=>replication.assertRawMutationAllowed("session:synthetic")).not.toThrow();expect(()=>replication.assertLegacyRecoveryAllowed()).toThrow("RECOVERY_ADMISSION_REQUIRED");
  });
});

describe("dormant HTTPS suppression transport",()=>{
  const configuration={MIRA_SUPPRESSION_AUTHORITY_URL:"https://independent.example.test/journal/append",MIRA_SUPPRESSION_AUTHORITY_ID:authorityId,MIRA_SUPPRESSION_AUTHORITY_TOKEN:"synthetic-test-only-token-123456789"};
  it("requires complete pinned server configuration and rejects redirects/unsafe URLs",()=>{
    expect(suppressionTransport({})).toBeUndefined();
    for(const url of ["http://authority.test/","https://user:pass@authority.test/","https://authority.test/?token=bad","https://authority.test/#bad","https://authority.test:444/"]){expect(()=>suppressionTransport({...configuration,MIRA_SUPPRESSION_AUTHORITY_URL:url})).toThrow();}
    expect(()=>suppressionTransport({MIRA_SUPPRESSION_AUTHORITY_URL:configuration.MIRA_SUPPRESSION_AUTHORITY_URL,MIRA_SUPPRESSION_AUTHORITY_ID:authorityId})).toThrow();
  });
  it("sends only the strict protocol with no redirects, cache or indefinite wait",async()=>{
    const after=await genesisCheckpoint(writer),request=vi.fn<typeof fetch>(async()=>Response.json({...writer,...after}));
    await suppressionTransport(configuration,request)!.append({writer,after,entries:[]});
    expect(request).toHaveBeenCalledWith(new URL(configuration.MIRA_SUPPRESSION_AUTHORITY_URL),expect.objectContaining({method:"POST",redirect:"manual",cache:"no-store",signal:expect.any(AbortSignal)}));
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({writer,after,entries:[]});
  });
  it("bounds response bytes and does not return a provider error body",async()=>{
    const after=await genesisCheckpoint(writer);
    await expect(suppressionTransport(configuration,vi.fn(async()=>new Response("x".repeat(4097))))!.append({writer,after,entries:[]})).rejects.toThrow("RECEIPT_INVALID");
    await expect(suppressionTransport(configuration,vi.fn(async()=>new Response("sensitive provider details",{status:503})))!.append({writer,after,entries:[]})).rejects.toThrow("AUTHORITY_UNAVAILABLE");
    await expect(suppressionTransport(configuration,vi.fn(async()=>new Response(null,{status:302,headers:{location:"https://untrusted.example.test/"}})))!.append({writer,after,entries:[]})).rejects.toThrow("AUTHORITY_UNAVAILABLE");
  });
});

describe("configured protection survives rollback past activation",()=>{
  it("refuses normal, raw and legacy access after the local protection row disappears and the source restarts",async()=>{
    seed();await replication.beginProtection(writer);await replication.flush();
    source!.transaction(()=>source!.sql.exec("DELETE FROM suppression_protection"));
    source!.db.close();source=database(join(directory,"source.sqlite"));
    store=new StoreEngine(source.sql);journal=new RecoveryJournal(source.sql);
    replication=new SourceSuppressionReplicator(source.sql,source.transaction,sourceId,()=>transport);
    requests.length=0;
    const normalRead=vi.fn(()=>store.get("account:synthetic-adult"));
    const normalMutation=vi.fn(()=>store.eraseAccount("synthetic-adult","synthetic-adult",[]));

    expect(()=>replication.isProtected()).toThrow("SUPPRESSION_PROTECTION_REQUIRED");
    expect(()=>replication.status()).toThrow("SUPPRESSION_PROTECTION_REQUIRED");
    await expect(replication.flush()).rejects.toThrow("SUPPRESSION_PROTECTION_REQUIRED");
    await expect(protectedMutation(normalRead)).rejects.toThrow("SUPPRESSION_PROTECTION_REQUIRED");
    await expect(protectedMutation(normalMutation)).rejects.toThrow("SUPPRESSION_PROTECTION_REQUIRED");
    for(const key of ["account:synthetic-adult","state:synthetic-adult","session:synthetic"])
      expect(()=>replication.assertRawMutationAllowed(key)).toThrow("SUPPRESSION_PROTECTION_REQUIRED");
    expect(()=>replication.assertLegacyRecoveryAllowed()).toThrow("SUPPRESSION_PROTECTION_REQUIRED");
    expect(normalRead).not.toHaveBeenCalled();expect(normalMutation).not.toHaveBeenCalled();
    expect(requests).toEqual([]);expect(journal.watermark()).toBe(1);
    expect(store.get("account:synthetic-adult")).not.toBeNull();
    expect(source.sql.exec("SELECT * FROM suppression_protection").toArray()).toEqual([]);
  });

  it("allows only explicit internal provisioning to establish the missing row, while truly unconfigured dormant operation remains available",async()=>{
    const originalTransport=transport;
    expect(()=>replication.status()).toThrow("SUPPRESSION_PROTECTION_REQUIRED");
    await expect(replication.flush()).rejects.toThrow("SUPPRESSION_PROTECTION_REQUIRED");
    expect(requests).toEqual([]);
    transport=undefined;
    expect(replication.isProtected()).toBe(false);
    expect(replication.status()).toMatchObject({protected:false,acknowledgedSequence:null});
    expect(()=>replication.assertRawMutationAllowed("state:synthetic-adult")).not.toThrow();
    expect(()=>replication.assertLegacyRecoveryAllowed()).not.toThrow();
    await replication.flush();expect(requests).toEqual([]);
    transport=originalTransport;
    await replication.beginProtection(writer);await replication.flush();
    expect(replication.status()).toMatchObject({protected:true,acknowledgedSequence:0,pending:0});
    expect(requests).toHaveLength(1);
  });

  it("fails closed for partially configured authorities with no local protection row and never sends an append",async()=>{
    const network=vi.fn<typeof fetch>(async()=>{throw new Error("Synthetic network must not run");});
    const partial:Parameters<typeof suppressionTransport>[0][]=[
      {MIRA_SUPPRESSION_AUTHORITY_URL:"https://independent.example.test/journal/append"},
      {MIRA_SUPPRESSION_AUTHORITY_ID:authorityId},
      {MIRA_SUPPRESSION_AUTHORITY_TOKEN:"synthetic-test-only-token-123456789"},
      {MIRA_SUPPRESSION_AUTHORITY_URL:"https://independent.example.test/journal/append",MIRA_SUPPRESSION_AUTHORITY_ID:authorityId},
    ];
    for(const configuration of partial){
      replication=new SourceSuppressionReplicator(source!.sql,source!.transaction,sourceId,()=>suppressionTransport(configuration,network));
      expect(()=>replication.isProtected()).toThrow();expect(()=>replication.status()).toThrow();
      await expect(replication.flush()).rejects.toThrow();
      expect(()=>replication.assertRawMutationAllowed("state:synthetic-adult")).toThrow();
      expect(()=>replication.assertLegacyRecoveryAllowed()).toThrow();
      const work=vi.fn(()=>store.get("account:synthetic-adult"));
      await expect(protectedMutation(work)).rejects.toThrow();expect(work).not.toHaveBeenCalled();
    }
    expect(network).not.toHaveBeenCalled();expect(requests).toEqual([]);
    expect(source!.sql.exec("SELECT * FROM suppression_protection").toArray()).toEqual([]);
  });
});
