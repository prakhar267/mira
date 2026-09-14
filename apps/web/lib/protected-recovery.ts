import {z} from "zod";
import {BackupEngine,archiveManifestSchema} from "./backup-engine";
import {backupDigest,openBackup,sealBackup,type BackupKey} from "./backup-crypto";
import {runBackupOperation,type BackupEnvironment} from "./backup-operations";
import {SourceSuppressionReplicator} from "./suppression-replication";
import {genesisCheckpoint,receiptSchema,writerSchema} from "./suppression-protocol";
import {archiveRegistrationSchema,archiveRegistrationReceiptSchema,recoveryAdmissionSchema,recoveryHandoffSchema,type RecoveryAuthority} from "./protected-recovery-protocol";
import {verifyAuthorityQuarantinePage} from "./authority-quarantine";
import {AUTHORITY_PREPARATION_MAX_EVENTS} from "./authority-quarantine-protocol";

export const protectedArchiveSchema=z.object({version:z.literal(2),kind:z.literal("protected-snapshot"),snapshot:archiveManifestSchema,registration:archiveRegistrationReceiptSchema}).strict();
export interface ProtectedRecoveryEnvironment extends BackupEnvironment {MIRA_PROTECTED_RECOVERY_ENABLED?:string}
type Transaction=<T>(work:()=>T)=>T;
const field=z.string().regex(/^[A-Za-z0-9_-]{1,120}$/);
const common=z.object({action:z.literal("protectedRecovery").optional(),target:z.string().regex(/^(?:mira-production-v1|mira-recovery-[a-z0-9-]{8,80})$/)});
const requestSchema=z.discriminatedUnion("operation",[
  common.extend({operation:z.literal("protect"),writerId:field,confirm:z.literal("ENABLE INDEPENDENT SUPPRESSION")}).strict(),
  common.extend({operation:z.enum(["status","begin","restoreStep"])}).strict(),
  common.extend({operation:z.enum(["page","finish","cancel"]),archiveId:field,nonce:field}).strict(),
  common.extend({operation:z.enum(["restoreBegin","restoreChunk"]),sealed:z.unknown()}).strict(),
]);

/** Bounded awaits also protect internal injected adapters. After cancellation
 * this operation cannot pin/admit/open a target. An already running replication
 * flush may durably finish immutable acknowledgements; that is not admission.
 * Remote operations retry the same identities; HTTP also has body limits. */
async function bounded<T>(signal:AbortSignal,work:()=>Promise<T>):Promise<T>{
  signal.throwIfAborted();let stop=()=>{};
  const aborted=new Promise<never>((_,reject)=>{stop=()=>reject(new Error("RECOVERY_AUTHORITY_UNAVAILABLE"));signal.addEventListener("abort",stop,{once:true});});
  try{return await Promise.race([Promise.resolve().then(()=>{signal.throwIfAborted();return work();}),aborted]);}
  finally{signal.removeEventListener("abort",stop);}
}

/** Operator-only v2 state machine. It never accepts a caller-provided coverage
 * receipt for export: the manifest and current acknowledged checkpoint come
 * from the frozen source. Restore trusts only the separately configured live
 * authority, not the encrypted file as a claim of latest deletion state. */
export async function runProtectedRecovery(engine:BackupEngine,replication:SourceSuppressionReplicator,transaction:Transaction,environment:ProtectedRecoveryEnvironment,resolve:()=>RecoveryAuthority,raw:unknown){
  if(environment.MIRA_PROTECTED_RECOVERY_ENABLED!=="true")throw new Error("RECOVERY_V2_DISABLED");
  const input=requestSchema.parse(raw),key:BackupKey={keyId:environment.MIRA_BACKUP_KEY_ID??"",material:environment.MIRA_BACKUP_KEY??""};
  await sealBackup({configurationCheck:true},"cutover",key);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15_000),signal=controller.signal;
  try {
  const remote=async<T>(work:(authority:RecoveryAuthority)=>Promise<T>)=>bounded(signal,()=>work(resolve()));
  const flush=()=>bounded(signal,()=>replication.flush());
  const check=()=>signal.throwIfAborted();
  const handoff=async()=>{
    const state=transaction(()=>engine.protectedRestoreState());
    const registration=archiveRegistrationSchema.parse({writer:state.registration.writer,archiveId:state.registration.archiveId,manifestDigest:state.registration.manifestDigest,checkpoint:state.registration.checkpoint});
    const target=state.progress?.binding.target??state.handoff?.target,challenge=state.progress?.binding.challenge??state.handoff?.challenge;
    if(!target||!challenge||target!==input.target)throw new Error("RESTORE_HANDOFF_CHANGED");
    const authority=resolve();if(authority.authorityId!==registration.writer.authorityId)throw new Error("RESTORE_AUTHORITY_UNAVAILABLE");
    const result=recoveryHandoffSchema.parse(await remote(a=>a.handoff({registration,target,challenge,successor:state.successor})));
    check();
    if(state.complete){if(JSON.stringify(result)!==JSON.stringify(state.handoff))throw new Error("RESTORE_HANDOFF_CHANGED");await flush();return state;}
    return transaction(()=>engine.pinProtectedHandoff(result));
  };
  switch(input.operation){
    case "protect":{
      transaction(()=>engine.assertAvailable());
      const authority=resolve(),writer=writerSchema.parse({authorityId:authority.authorityId,source:engine.source(),writerId:input.writerId,epoch:1});
      const receipt=receiptSchema.parse(await remote(a=>a.enroll(writer.source,writer.writerId)));
      if(receipt.authorityId!==writer.authorityId||receipt.source!==writer.source||receipt.writerId!==writer.writerId||receipt.epoch!==writer.epoch)throw new Error("SUPPRESSION_RECEIPT_INVALID");
      check();transaction(()=>engine.assertAvailable());await replication.beginProtection(writer);await flush();return replication.status();
    }
    case "status":return {...transaction(()=>engine.status()),protection:replication.status()};
    case "begin":{
      await flush();check();
      return transaction(()=>{const p=replication.protection();if(p.acknowledged.sequence!==engine.status().watermark)throw new Error("SUPPRESSION_BACKLOG_PENDING");if(p.acknowledged.sequence>AUTHORITY_PREPARATION_MAX_EVENTS)throw new Error("BACKUP_SUPPRESSION_LIMIT");return engine.begin("snapshot");});
    }
    case "page":case "cancel":return await runBackupOperation(engine,transaction,environment,input);
    case "finish":{
      await flush();check();
      const snapshot=transaction(()=>engine.manifest(input.archiveId,input.nonce)),p=replication.protection();
      if(p.acknowledged.sequence!==snapshot.watermark)throw new Error("SUPPRESSION_CAPTURE_CHANGED");
      const registration={writer:p.writer,archiveId:snapshot.archiveId,manifestDigest:await backupDigest(snapshot),checkpoint:p.acknowledged};
      const receipt=archiveRegistrationReceiptSchema.parse(await remote(a=>a.register(registration)));
      if(JSON.stringify(receipt)!==JSON.stringify({...registration,registered:true}))throw new Error("SUPPRESSION_RECEIPT_INVALID");
      const sealed=await sealBackup(protectedArchiveSchema.parse({version:2,kind:"protected-snapshot",snapshot,registration:receipt}),"manifest",key);
      check();transaction(()=>engine.finish(input.archiveId,input.nonce));return {sealed};
    }
    case "restoreBegin":{
      const archive=protectedArchiveSchema.parse(await openBackup(input.sealed,"manifest",key)),digest=await backupDigest(archive.snapshot),writer=archive.registration.writer;
      if(resolve().authorityId!==writer.authorityId)throw new Error("RESTORE_AUTHORITY_UNAVAILABLE");
      const genesis=await genesisCheckpoint(writer);check();
      transaction(()=>engine.beginProtectedRestore(archive.snapshot,input.target,archive.registration,digest,genesis));
      return await handoff();
    }
    case "restoreChunk":{
      const state=await handoff();if(state.complete)return state;
      const chunk=await openBackup(input.sealed,"chunk",key),digest=await backupDigest(chunk);check();
      return transaction(()=>engine.importChunk(chunk,digest));
    }
    case "restoreStep":{
      let state=await handoff();if(state.complete)return state;
      for(let i=0;i<8;i++){
        check();state=transaction(()=>engine.protectedRestoreState());const progress=state.progress!;
        if(progress.snapshotNext!==progress.snapshotChunks)return state;
        if(progress.cursor.sequence<progress.fence!.sequence){
          const page=await remote(a=>a.read(state.registration.writer,progress.cursor,128));
          const verified=await verifyAuthorityQuarantinePage(progress.binding,progress.fence!,progress.cursor,page);check();
          transaction(()=>engine.importAuthorityPage(verified));
        }else if(!progress.prepared){transaction(()=>engine.validateAuthorityPreparation());}
        else{
          await replication.beginProtection(state.successor);
          try{await flush();}catch(error){if(error instanceof Error&&error.message==="SUPPRESSION_BACKLOG_PENDING")return transaction(()=>engine.protectedRestoreState());throw error;}
          const p=replication.protection(),admission=recoveryAdmissionSchema.parse(await remote(a=>a.admit(state.handoff!,p.acknowledged)));
          await flush();check();return transaction(()=>engine.finalizeProtectedRestore(admission));
        }
      }
      return transaction(()=>engine.protectedRestoreState());
    }
  }
  } finally {clearTimeout(timer);}
}
