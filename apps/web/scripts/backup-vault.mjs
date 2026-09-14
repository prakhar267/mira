import {mkdir,open,readFile,lstat,realpath,rename} from "node:fs/promises";
import {isAbsolute,join,dirname} from "node:path";
import {backupDigest,openBackup,BACKUP_MAX_CHUNKS,BACKUP_MAX_BYTES} from "../lib/backup-crypto.ts";

const maxFile=2_600_000;
async function privateWrite(path,value){const file=await open(path,"wx",0o600);try{await file.writeFile(JSON.stringify(value));await file.sync();}finally{await file.close();}}
async function readBounded(path){const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>maxFile)throw Error("Vault entry is not a bounded regular file");return JSON.parse(await readFile(path,"utf8"));}
export async function vaultPath(path){if(!path||!isAbsolute(path))throw Error("An explicit absolute vault directory is required");await mkdir(path,{recursive:true,mode:0o700});return realpath(path);}
async function syncDirectory(path){const handle=await open(path,"r");try{await handle.sync();}finally{await handle.close();}}

/** A mounted, separately managed vault adapter, not a claim of offsite storage.
 * Only ciphertext is written. Key material must live outside these directories. */
export async function captureArchive(call,vault,key,kind="snapshot"){
  const root=await vaultPath(vault),job=await call({operation:kind==="ledger"?"ledger":"begin"});
  if(!/^[A-Za-z0-9_-]{1,120}$/.test(job.archiveId))throw Error("Invalid archive identifier");
  const directory=join(root,job.archiveId);await mkdir(directory,{mode:0o700});
  let index=0,finished=false;
  try{
    for(;;){if(index>=BACKUP_MAX_CHUNKS)throw Error("Archive chunk bound exceeded");const page=await call({operation:"page",archiveId:job.archiveId,nonce:job.nonce});if(page.done)break;
      const chunk=await openBackup(page.sealed,"chunk",key);if(chunk.archiveId!==job.archiveId||chunk.index!==index||chunk.kind!==kind)throw Error("Archive sequence mismatch");
      await privateWrite(join(directory,`${String(index).padStart(6,"0")}.sealed.json`),page.sealed);index++;
    }
    const result=await call({operation:"finish",archiveId:job.archiveId,nonce:job.nonce});finished=true;
    await privateWrite(join(directory,"manifest.sealed.json"),result.sealed);await syncDirectory(directory);
    const verified=await verifyArchive(directory,key);
    const checkpoint={version:1,archiveId:job.archiveId,source:verified.manifest.source,watermark:verified.manifest.watermark,manifestDigest:await backupDigest(result.sealed),recordedAt:new Date().toISOString(),note:"This local pointer is not independent rollback-proof freshness evidence."};
    const temporary=join(root,`.latest-${crypto.randomUUID()}.json`);await privateWrite(temporary,checkpoint);await rename(temporary,join(root,"latest.json"));await syncDirectory(root);
    return {directory,...verified};
  }catch(cause){if(kind==="snapshot"&&!finished)await call({operation:"cancel",archiveId:job.archiveId,nonce:job.nonce}).catch(()=>{});throw cause;}
}
export async function verifyArchive(directory,key){
  const root=await realpath(directory),sealed=await readBounded(join(root,"manifest.sealed.json")),envelope=await openBackup(sealed,"manifest",key);
  const manifest=envelope.version===2&&envelope.kind==="protected-snapshot"?envelope.snapshot:envelope;
  if(manifest.version!==1||!Array.isArray(manifest.chunks)||manifest.chunks.length>BACKUP_MAX_CHUNKS||!["snapshot","ledger"].includes(manifest.kind)||!Number.isSafeInteger(manifest.totalBytes)||manifest.totalBytes>BACKUP_MAX_BYTES)throw Error("Unsupported archive manifest");
  let bytes=0,rows=0;
  for(let index=0;index<manifest.chunks.length;index++){const part=manifest.chunks[index];if(part.index!==index)throw Error("Archive chunk order invalid");const chunk=await openBackup(await readBounded(join(root,`${String(index).padStart(6,"0")}.sealed.json`)),"chunk",key);
    if(chunk.archiveId!==manifest.archiveId||chunk.source!==manifest.source||chunk.kind!==manifest.kind||chunk.index!==index||chunk.table!==part.table||chunk.rows.length!==part.rows||await backupDigest(chunk)!==part.digest)throw Error("Archive integrity verification failed");
    const length=new TextEncoder().encode(JSON.stringify(chunk)).length;if(length!==part.bytes)throw Error("Archive byte accounting mismatch");bytes+=length;rows+=chunk.rows.length;
  }
  if(bytes!==manifest.totalBytes||rows!==manifest.totalRows)throw Error("Archive is incomplete");return {manifest,sealed,directory:root,version:envelope.version};
}
export async function restoreArchive(sourceCall,targetCall,archiveDirectory,ledgerVault,key,target,confirmation){
  if(confirmation!=="RETIRE mira-production-v1"||!/^mira-recovery-[a-z0-9-]{8,80}$/.test(target))throw Error("Explicit source retirement and isolated target confirmation required");
  const archive=await verifyArchive(archiveDirectory,key);if(archive.manifest.kind!=="snapshot")throw Error("A snapshot archive is required");
  const ledgerRoot=await vaultPath(ledgerVault),dataRoot=dirname(archive.directory);if(ledgerRoot===dataRoot||ledgerRoot.startsWith(`${dataRoot}/`)||dataRoot.startsWith(`${ledgerRoot}/`))throw Error("The ledger vault must be separate from the data archive vault");
  const previous=await targetCall({operation:"status"});if(previous.mode==="active"&&previous.restored?.archiveId===archive.manifest.archiveId)return {complete:true,alreadyRestored:true};
  const start=previous.mode==="restore"?previous:await targetCall({operation:"restoreBegin",sealed:archive.sealed,target});
  if(start.archiveId!==archive.manifest.archiveId||start.target!==target)throw Error("Target has a different quarantined restore");
  // This is an irreversible explicit operator action, not ordinary backup.
  // A stale local ledger/head is never substituted if the source is unavailable.
  const proof=await sourceCall({operation:"retire",destination:target,challenge:start.challenge,backupId:archive.manifest.archiveId,source:archive.manifest.source,confirm:confirmation});
  const ledger=start.ledgerArchiveId?await verifyArchive(join(ledgerRoot,start.ledgerArchiveId),key):await captureArchive(sourceCall,ledgerRoot,key,"ledger");
  await privateWrite(join(ledger.directory,`cutover-${crypto.randomUUID()}.sealed.json`),proof.sealed);
  const cutover=await openBackup(proof.sealed,"cutover",key);if(cutover.watermark!==ledger.manifest.watermark)throw Error("Current cutover watermark is not the independently archived ledger watermark");
  await targetCall({operation:"restoreLedger",sealed:ledger.sealed});
  for(const source of [archive,ledger])for(let index=0;index<source.manifest.chunks.length;index++)await targetCall({operation:"restoreChunk",sealed:await readBounded(join(source.directory,`${String(index).padStart(6,"0")}.sealed.json`))});
  let result;for(let batch=0;batch<501;batch++){result=await targetCall({operation:"restoreFinalize",sealed:proof.sealed});if(result.complete)return {...result,snapshotWatermark:archive.manifest.watermark,suppressionWatermark:ledger.manifest.watermark};}
  throw Error("Restore validation exceeded its account bound; target remains quarantined");
}
export function operatorClient(url,token,target="mira-production-v1"){
  const endpoint=new URL("/api/admin/backup",url);if(endpoint.protocol!=="https:"&&!(["localhost","127.0.0.1"].includes(endpoint.hostname)&&endpoint.protocol==="http:"))throw Error("Backup transport requires HTTPS");if(!token)throw Error("MIRA_BACKUP_OPERATOR_KEY is required");
  return async data=>{const response=await fetch(endpoint,{method:"POST",redirect:"error",headers:{authorization:`Bearer ${token}`,"content-type":"application/json",origin:endpoint.origin},body:JSON.stringify({...data,target}),signal:AbortSignal.timeout(30_000)});const length=Number(response.headers.get("content-length")??0);if(length>maxFile)throw Error("Backup response too large");const reader=response.body.getReader();let size=0,text="";const decoder=new TextDecoder();for(;;){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>maxFile){await reader.cancel();throw Error("Backup response too large");}text+=decoder.decode(item.value,{stream:true});}text+=decoder.decode();const result=JSON.parse(text);if(!response.ok)throw Error(result.code??"Backup request failed");return result;};
}

/** Source-loss restore: only the surviving archive and target endpoint are
 * contacted. Every resume rechecks the live independent authority server-side.
 * Routing is a separate explicit deployment configuration, never a CLI side
 * effect. Physical source retirement is neither requested nor fabricated. */
export async function restoreProtectedArchive(targetCall,archiveDirectory,key,target){
  if(!/^mira-recovery-[a-z0-9-]{8,80}$/.test(target))throw Error("Explicit isolated target required");
  const archive=await verifyArchive(archiveDirectory,key);if(archive.version!==2)throw Error("A protected v2 archive is required");
  let result=await targetCall({operation:"restoreBegin",sealed:archive.sealed});
  if(result.complete)return result;
  for(let index=result.progress.snapshotNext;index<archive.manifest.chunks.length;index++)await targetCall({operation:"restoreChunk",sealed:await readBounded(join(archive.directory,`${String(index).padStart(6,"0")}.sealed.json`))});
  for(let batch=0;batch<2000;batch++){result=await targetCall({operation:"restoreStep"});if(result.complete)return result;}
  throw Error("Bounded recovery unfinished; resume the same target/archive. It remains quarantined.");
}
