import {DatabaseSync} from "node:sqlite";
import {mkdtemp,readFile,rm,unlink} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {StoreEngine,type SqlStorage} from "./store-engine";
import {BackupEngine} from "./backup-engine";
import {SourceSuppressionReplicator} from "./suppression-replication";
import {SuppressionAuthorityEngine} from "./suppression-authority";
import {RecoveryJournal} from "./recovery-journal";
import {runProtectedRecovery,protectedArchiveSchema} from "./protected-recovery";
import {recoveryAuthorityTransport} from "./recovery-authority-transport";
import {serveRecoveryAuthority} from "./recovery-authority-service";
import {boundedRecoveryJson} from "./recovery-io";
import {suppressionTransport} from "./suppression-transport";
import {backupDigest,openBackup,sealBackup,type BackupKey} from "./backup-crypto";
import {genesisCheckpoint} from "./suppression-protocol";
import {freshDemo} from "./demo-storage";
// @ts-expect-error Independently executable operator adapter.
import {captureArchive,restoreProtectedArchive} from "../scripts/backup-vault.mjs";

let directory:string,key:BackupKey;
const handles=new Set<DatabaseSync>(),external=vi.fn(async()=>{throw Error("External network forbidden");});
const targetName="mira-recovery-synthetic-target";
function database(name:string){
  const path=join(directory,name),db=new DatabaseSync(path);handles.add(db);
  const sql:SqlStorage={exec(query,...values){const rows=db.prepare(query).all(...values) as Record<string,unknown>[];return {toArray:()=>rows};}};
  const transaction=<T>(work:()=>T):T=>{db.exec("BEGIN IMMEDIATE");try{const value=work();if(value instanceof Promise)throw Error("Async SQL forbidden");db.exec("COMMIT");return value;}catch(error){db.exec("ROLLBACK");throw error;}};
  const store=new StoreEngine(sql),backup=new BackupEngine(sql,store),journal=new RecoveryJournal(sql);
  return {path,db,sql,store,backup,journal,transaction,close(){db.close();handles.delete(db);}};
}
type Database=ReturnType<typeof database>;
async function account(source:Database,name:string){
  const id=crypto.randomUUID(),now=new Date().toISOString(),emailKey=(await backupDigest(`${name}@example.test`)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  const state=freshDemo();state.user.id=id;state.user.name=name;state.user.adultConfirmed=true;state.memoryEnabled=true;state.aiProcessingConsent=true;state.conversationStorageEnabled=true;state.messages=[{id:crypto.randomUUID(),conversationId:state.activeConversationId,role:"user",content:"Synthetic recoverable conversation",createdAt:now}];
  source.transaction(()=>source.store.bootstrap(`email:${emailKey}`,{id,name,emailKey,email:`${name}@example.test`,passwordHash:"a".repeat(43),passwordSalt:"b".repeat(22),emailVerifiedAt:now,createdAt:now,updatedAt:now} as {id:string},state,`session:${name}`,JSON.stringify({userId:id,createdAt:now}),86400));
  return {id,emailKey,conversationId:state.activeConversationId};
}
async function fixture(){
  const source=database("source.sqlite"),independent=database("independent.sqlite"),target=database("target.sqlite");
  const environment={MIRA_PROTECTED_RECOVERY_ENABLED:"true",MIRA_BACKUP_KEY:key.material,MIRA_BACKUP_KEY_ID:key.keyId,MIRA_SUPPRESSION_AUTHORITY_ID:"synthetic-independent",MIRA_SUPPRESSION_AUTHORITY_URL:"https://authority.example.test/",MIRA_SUPPRESSION_AUTHORITY_TOKEN:"s".repeat(40),MIRA_RECOVERY_AUTHORITY_TOKEN:"o".repeat(40)};
  const core=new SuppressionAuthorityEngine(independent.sql,independent.transaction,environment.MIRA_SUPPRESSION_AUTHORITY_ID);
  const request=vi.fn<typeof fetch>(async(url,init)=>{expect(String(url)).toBe(environment.MIRA_SUPPRESSION_AUTHORITY_URL);return serveRecoveryAuthority(new Request(url,init),core,environment);});
  const resolver=()=>recoveryAuthorityTransport(environment,request);
  const wrap=(db:Database,name:string)=>{
    const replication=new SourceSuppressionReplicator(db.sql,db.transaction,db.backup.source(),()=>suppressionTransport(environment,request));
    const call=(input:Record<string,unknown>)=>runProtectedRecovery(db.backup,replication,db.transaction,environment,resolver,{...input,target:name});
    return {replication,call};
  };
  const sourceClient=wrap(source,"mira-production-v1"),targetClient=wrap(target,targetName);
  const kept=await account(source,"kept"),deleted=await account(source,"deleted");
  source.transaction(()=>source.store.memoryCommand(kept.id,{action:"create",content:"Synthetic forgotten secret"},source.store.readAccountState(kept.id)!.revision));
  const memoryId=source.store.readAccountState(kept.id)!.state.memories[0]!.id;
  await sourceClient.call({operation:"protect",writerId:"source-writer",confirm:"ENABLE INDEPENDENT SUPPRESSION"});
  const archive=await captureArchive(sourceClient.call,join(directory,"vault"),key);
  const writer=sourceClient.replication.protection().writer;
  async function mutate(){source.transaction(()=>{
    source.store.memoryCommand(kept.id,{action:"forget",id:memoryId},source.store.readAccountState(kept.id)!.revision);
    source.store.acceptPolicy(kept.id,{aiProcessingConsent:false,memoryEnabled:false,conversationStorageEnabled:false},source.store.readAccountState(kept.id)!.revision);
    source.store.eraseAccount(deleted.id,deleted.emailKey,[]);
  });await sourceClient.replication.flush();}
  async function chunks(call=targetClient.call){for(let index=0;index<archive.manifest.chunks.length;index++)await call({operation:"restoreChunk",sealed:JSON.parse(await readFile(join(archive.directory,`${String(index).padStart(6,"0")}.sealed.json`),"utf8"))});}
  return {source,independent,target,environment,core,request,resolver,wrap,sourceClient,targetClient,kept,deleted,memoryId,archive,writer,mutate,chunks};
}
beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),"mira-protected-recovery-"));key={keyId:"synthetic",material:Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64")};external.mockClear();vi.stubGlobal("fetch",external);});
afterEach(async()=>{for(const db of handles)db.close();handles.clear();vi.restoreAllMocks();vi.unstubAllGlobals();await rm(directory,{recursive:true,force:true});expect(external).not.toHaveBeenCalled();});

describe("protected archive v2 usable source-loss recovery",()=>{
  it("physically destroys source before retirement, restores suppressed data safely, then independently acknowledges new target deletions",async()=>{
    const f=await fixture();await f.mutate();const retire=vi.spyOn(f.source.backup,"retire");
    f.source.close();await unlink(f.source.path);await expect(readFile(f.source.path)).rejects.toMatchObject({code:"ENOENT"});
    const start=performance.now(),result=await restoreProtectedArchive(f.targetClient.call,f.archive.directory,key,targetName),elapsedMs=performance.now()-start;
    expect(result).toMatchObject({version:2,mode:"active",complete:true,admission:{admitted:true}});expect(retire).not.toHaveBeenCalled();
    await f.targetClient.replication.flush();expect(()=>f.target.backup.assertAvailable()).not.toThrow();
    const profile=f.target.transaction(()=>f.target.store.readAccountState(f.kept.id))!;
    expect(profile.state.memories).toEqual([]);expect(profile.state.messages).toEqual([]);expect(profile.state.aiProcessingConsent).toBe(false);expect(f.target.store.get(`account:${f.deleted.id}`)).toBeNull();
    const credentials=JSON.parse(f.target.store.get(`account:${f.kept.id}`)!);
    expect(credentials).toMatchObject({passwordResetRequired:true,recoveryVerificationRequired:true});expect(credentials.passwordHash).not.toBe("a".repeat(43));expect(credentials.emailVerifiedAt).toBeUndefined();expect(f.target.store.get("session:kept")).toBeNull();
    await expect(f.core.append({writer:f.writer,after:await genesisCheckpoint(f.writer),entries:[]})).rejects.toThrow("SUPPRESSION_WRITER_FENCED");
    f.target.transaction(()=>f.target.store.eraseAccount(f.kept.id,f.kept.emailKey,[]));await f.targetClient.replication.flush();
    const successor=f.targetClient.replication.protection().writer,page=f.core.read(successor,await genesisCheckpoint(successor));
    expect(page.entries.at(-1)?.event).toEqual({kind:"account",userId:f.kept.id});expect(f.target.store.get(`account:${f.kept.id}`)).toBeNull();
    expect(JSON.stringify(page)).not.toContain("Synthetic forgotten secret");
    console.log(JSON.stringify({evidence:"protected-v2-source-loss-restore",sourcePhysicallyRemoved:true,retirementCalled:false,elapsedMs:Math.round(elapsedMs*100)/100,restoredServingMode:"active-protected",newDeletionIndependentlyAcked:true,productionActivated:false}));
  });
  it("does not open without complete inherited acknowledgement and resumes lost handoff/admission responses across target SQL restart",async()=>{
    const f=await fixture();await f.mutate();const actual=f.core.handoff.bind(f.core);let drop=true;
    vi.spyOn(f.core,"handoff").mockImplementation(async request=>{const result=await actual(request);if(drop){drop=false;throw Error("lost handoff response");}return result;});
    await expect(f.targetClient.call({operation:"restoreBegin",sealed:f.archive.sealed})).rejects.toThrow("RECOVERY_AUTHORITY_UNAVAILABLE");
    expect(()=>f.target.backup.assertAvailable()).toThrow("RECOVERY_MAINTENANCE");
    f.target.close();const reopened=database("target.sqlite"),client=f.wrap(reopened,targetName);
    await client.call({operation:"restoreBegin",sealed:f.archive.sealed});await f.chunks(client.call);
    const admit=f.core.admit.bind(f.core);let lost=true;
    vi.spyOn(f.core,"admit").mockImplementation((handoff,checkpoint)=>{const result=admit(handoff,checkpoint);if(lost){lost=false;throw Error("lost admission response");}return result;});
    await expect(client.call({operation:"restoreStep"})).rejects.toThrow("RECOVERY_AUTHORITY_UNAVAILABLE");expect(()=>reopened.backup.assertAvailable()).toThrow("RECOVERY_MAINTENANCE");
    expect((await client.call({operation:"restoreStep"})) as object).toMatchObject({complete:true});
    reopened.transaction(()=>reopened.store.eraseAccount(f.kept.id,f.kept.emailKey,[]));await client.replication.flush();
    const state=reopened.backup.protectedRestoreState();expect(f.core.admit(state.handoff!,client.replication.protection().acknowledged)).toEqual(state.admission);
    expect((await client.call({operation:"restoreBegin",sealed:f.archive.sealed})) as object).toMatchObject({complete:true});
  });
  it("rejects unregistered/substituted archives, a second target and v1 quarantine promotion",async()=>{
    const f=await fixture(),archive=protectedArchiveSchema.parse(await openBackup(f.archive.sealed,"manifest",key));
    const altered={...archive,snapshot:{...archive.snapshot,createdAt:archive.snapshot.createdAt+1}};
    await expect(f.targetClient.call({operation:"restoreBegin",sealed:await sealBackup(altered,"manifest",key)})).rejects.toThrow("RESTORE_COVERAGE_INVALID");
    await f.targetClient.call({operation:"restoreBegin",sealed:f.archive.sealed});f.target.close();const reopened=database("target.sqlite"),client=f.wrap(reopened,targetName);
    const registration={...archive.registration,archiveId:"different-archive"},changed={...archive,snapshot:{...archive.snapshot,archiveId:registration.archiveId},registration};changed.registration.manifestDigest=await backupDigest(changed.snapshot);
    await expect(client.call({operation:"restoreBegin",sealed:await sealBackup(changed,"manifest",key)})).rejects.toThrow("RESTORE_COVERAGE_CHANGED");
    const other=database("other.sqlite"),otherClient=f.wrap(other,"mira-recovery-other-target");
    await expect(otherClient.call({operation:"restoreBegin",sealed:f.archive.sealed})).rejects.toThrow("RECOVERY_AUTHORITY_UNAVAILABLE");expect(()=>other.backup.assertAvailable()).toThrow("RECOVERY_MAINTENANCE");
    const legacy=database("legacy.sqlite");f.wrap(legacy,"mira-recovery-legacy-target");legacy.transaction(()=>legacy.backup.beginAuthorityQuarantine(archive.snapshot,"mira-recovery-legacy-target",f.writer,archive.registration.manifestDigest,{sequence:0,digest:"a".repeat(43)+"="}));
    await expect(runProtectedRecovery(legacy.backup,f.wrap(legacy,"mira-recovery-legacy-target").replication,legacy.transaction,f.environment,f.resolver,{operation:"restoreBegin",target:"mira-recovery-legacy-target",sealed:f.archive.sealed})).rejects.toThrow("RESTORE_TARGET_INVALID");
    expect(()=>legacy.transaction(()=>legacy.backup.finalize({}))).toThrow("RESTORE_AUTHORITY_QUARANTINED");
  });
  it("fails closed on missing authority, missing configuration and partial snapshot/suppression replay",async()=>{
    const f=await fixture();await f.mutate();await f.targetClient.call({operation:"restoreBegin",sealed:f.archive.sealed});
    expect((await f.targetClient.call({operation:"restoreStep"})) as object).toMatchObject({complete:false});expect(()=>f.target.backup.assertAvailable()).toThrow();await f.chunks();
    const read=vi.spyOn(f.core,"read").mockImplementation(()=>{throw Error("independent authority unavailable");});
    await expect(f.targetClient.call({operation:"restoreStep"})).rejects.toThrow("RECOVERY_AUTHORITY_UNAVAILABLE");expect(f.target.backup.authorityPreparationState().cursor.sequence).toBe(0);read.mockRestore();
    f.environment.MIRA_RECOVERY_AUTHORITY_TOKEN="";await expect(f.targetClient.call({operation:"restoreStep"})).rejects.toThrow("RECOVERY_AUTHORITY_CONFIGURATION_REQUIRED");expect(()=>f.target.backup.assertAvailable()).toThrow();
  });
  it("rolls back failed replay transactions and denies false inherited events before successor admission",async()=>{
    const f=await fixture();await f.mutate();await f.targetClient.call({operation:"restoreBegin",sealed:f.archive.sealed});await f.chunks();
    f.target.sql.exec("CREATE TRIGGER fail_recovery BEFORE INSERT ON recovery_events WHEN NEW.seq=2 BEGIN SELECT RAISE(ABORT,'SYNTHETIC_FAILURE'); END");
    await expect(f.targetClient.call({operation:"restoreStep"})).rejects.toThrow("SYNTHETIC_FAILURE");expect(f.target.journal.watermark()).toBe(0);f.target.sql.exec("DROP TRIGGER fail_recovery");
    const successor=f.target.backup.protectedRestoreState().successor,genesis=await genesisCheckpoint(successor);
    await expect(f.core.append({writer:successor,after:genesis,entries:[{sequence:1,event:{kind:"account",userId:"fabricated"}}]})).rejects.toThrow("SUPPRESSION_INHERITANCE_CONFLICT");
    expect((await f.targetClient.call({operation:"restoreStep"})) as object).toMatchObject({complete:true});
  });
  it("binds registration to frozen acknowledged source capture and rejects expired export leases",async()=>{
    const f=await fixture(),job=await f.sourceClient.call({operation:"begin"}) as {archiveId:string;nonce:string};
    for(;;){const page=await f.sourceClient.call({operation:"page",archiveId:job.archiveId,nonce:job.nonce}) as {done:boolean};if(page.done)break;}
    const register=f.core.registerArchive.bind(f.core);
    vi.spyOn(f.core,"registerArchive").mockImplementation(raw=>{const result=register(raw);f.source.sql.exec("UPDATE recovery_control SET value=json_set(value,'$.expires',0) WHERE key='control'");return result;});
    await expect(f.sourceClient.call({operation:"finish",archiveId:job.archiveId,nonce:job.nonce})).rejects.toThrow("BACKUP_LEASE_EXPIRED");
    expect(f.source.backup.status().mode).toBe("export");
  });
  it("rejects every nonempty target table, unknown protocol fields and disabled activation",async()=>{
    const f=await fixture();f.target.sql.exec("INSERT INTO memory_suppressions VALUES('synthetic-owner','old-id',1)");
    await expect(f.targetClient.call({operation:"restoreBegin",sealed:f.archive.sealed})).rejects.toThrow("RESTORE_TARGET_NOT_EMPTY");
    await expect(f.sourceClient.call({operation:"begin",registration:{registered:true}})).rejects.toThrow();
    f.environment.MIRA_PROTECTED_RECOVERY_ENABLED="false";await expect(f.sourceClient.call({operation:"begin"})).rejects.toThrow("RECOVERY_V2_DISABLED");
  });
  it("keeps source and operator capabilities separate, rejects oversized bodies, and refuses orphan authority metadata",async()=>{
    const f=await fixture();
    const send=(token:string,value:unknown)=>serveRecoveryAuthority(new Request("https://authority.example.test/",{method:"POST",headers:{authorization:`Bearer ${token}`},body:JSON.stringify(value)}),f.core,f.environment);
    expect((await send("x".repeat(40),{})).status).toBe(401);
    expect((await send(f.environment.MIRA_SUPPRESSION_AUTHORITY_TOKEN,{operation:"enroll",source:"rogue",writerId:"rogue"})).status).toBe(503);
    expect((await send(f.environment.MIRA_RECOVERY_AUTHORITY_TOKEN,{operation:"register",registration:{}})).status).toBe(503);
    expect((await send(f.environment.MIRA_RECOVERY_AUTHORITY_TOKEN,"x".repeat(300001))).status).toBe(413);
    const orphan=database("orphan.sqlite");new SuppressionAuthorityEngine(orphan.sql,orphan.transaction,"old-authority");orphan.sql.exec("DELETE FROM suppression_authority_identity");orphan.sql.exec("INSERT INTO suppression_archives VALUES('orphan','{}')");
    expect(()=>new SuppressionAuthorityEngine(orphan.sql,orphan.transaction,"new-authority")).toThrow("SUPPRESSION_AUTHORITY_CORRUPT");
  });
  it("captures another registered archive after recovery and safely hands off the successor a second time",async()=>{
    const f=await fixture();await restoreProtectedArchive(f.targetClient.call,f.archive.directory,key,targetName);
    const second=await captureArchive(f.targetClient.call,join(directory,"second-vault"),key);
    f.target.transaction(()=>f.target.store.eraseAccount(f.kept.id,f.kept.emailKey,[]));await f.targetClient.replication.flush();
    f.target.close();await unlink(f.target.path);
    const next=database("next-target.sqlite"),name="mira-recovery-next-generation",client=f.wrap(next,name);
    const result=await restoreProtectedArchive(client.call,second.directory,key,name);expect(result.complete).toBe(true);expect(next.store.get(`account:${f.kept.id}`)).toBeNull();
    next.backup.assertSelectedTarget(name);expect(()=>next.backup.assertSelectedTarget(targetName)).toThrow("RECOVERY_TARGET_NOT_ADMITTED");
  });
  it("a timed-out handoff cannot mutate target after return and resume rechecks the immutable authority operation",async()=>{
    const f=await fixture();let release!:()=>void,entered!:()=>void;const start=new Promise<void>(resolve=>{entered=resolve;}),held=new Promise<void>(resolve=>{release=resolve;});
    const actual=f.core.handoff.bind(f.core);vi.spyOn(f.core,"handoff").mockImplementation(async request=>{entered();await held;return actual(request);});
    let expire!:()=>void;const originalTimeout=globalThis.setTimeout;
    const timer=vi.spyOn(globalThis,"setTimeout").mockImplementation(((callback:()=>void,delay?:number)=>{if(delay===15_000){expire=callback;return originalTimeout(()=>{},60_000);}return originalTimeout(callback,delay);}) as typeof setTimeout);
    try{
      const operation=f.targetClient.call({operation:"restoreBegin",sealed:f.archive.sealed}),rejected=expect(operation).rejects.toThrow("RECOVERY_AUTHORITY_UNAVAILABLE");
      await start;expire();await rejected;
      expect(f.target.backup.authorityPreparationState().fence).toBeNull();release();await vi.waitFor(()=>expect(f.independent.sql.exec("SELECT source FROM suppression_handoffs").toArray()).toHaveLength(1));
      expect(f.target.backup.authorityPreparationState().fence).toBeNull();expect(()=>f.target.backup.assertAvailable()).toThrow("RECOVERY_MAINTENANCE");
    }finally{timer.mockRestore();}
    expect((await f.targetClient.call({operation:"restoreBegin",sealed:f.archive.sealed})) as object).toMatchObject({complete:false,handoff:{fenced:true}});
  });
  it("bounds authorized stalled/zero-byte body streams even when cancellation never settles",async()=>{
    const f=await fixture();let expire!:()=>void,ready!:()=>void;const started=new Promise<void>(resolve=>{ready=resolve;}),original=globalThis.setTimeout;
    const timer=vi.spyOn(globalThis,"setTimeout").mockImplementation(((callback:()=>void,delay?:number)=>{if(delay===4000){expire=callback;ready();return original(()=>{},60_000);}return original(callback,delay);}) as typeof setTimeout);
    const cancellation=vi.fn(()=>new Promise<void>(()=>{}));
    try{
      const stream=new ReadableStream<Uint8Array>({pull(){return new Promise(()=>{});},cancel:cancellation});
      const request=new Request("https://authority.example.test/",{method:"POST",headers:{authorization:`Bearer ${f.environment.MIRA_RECOVERY_AUTHORITY_TOKEN}`},body:stream,duplex:"half"} as RequestInit);
      const pending=serveRecoveryAuthority(request,f.core,f.environment);await started;expire();
      const response=await pending;expect(response.status).toBe(503);expect(await response.json()).toEqual({code:"RECOVERY_BODY_TIMEOUT"});expect(cancellation).toHaveBeenCalledOnce();
    }finally{timer.mockRestore();}
    const zeroCancel=vi.fn(()=>new Promise<void>(()=>{}));
    await expect(boundedRecoveryJson(new Response(new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(0));},cancel:zeroCancel})))).rejects.toThrow("RECOVERY_BODY_CHUNK_LIMIT");expect(zeroCancel).toHaveBeenCalledOnce();
    const bigCancel=vi.fn(()=>new Promise<void>(()=>{}));
    await expect(boundedRecoveryJson(new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(300001));},cancel:bigCancel})))).rejects.toThrow("RECOVERY_BODY_TOO_LARGE");expect(bigCancel).toHaveBeenCalledOnce();
  });
});
