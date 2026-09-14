import {captureArchive,operatorClient,restoreArchive,restoreProtectedArchive,verifyArchive} from "./backup-vault.mjs";

const [command,archive,target,confirmation]=process.argv.slice(2);
const key={keyId:process.env.MIRA_BACKUP_KEY_ID??"",material:process.env.MIRA_BACKUP_KEY??""};
if(!key.keyId||!key.material)throw Error("Explicit MIRA_BACKUP_KEY_ID and MIRA_BACKUP_KEY are required; keep them outside archive storage");
const source=()=>operatorClient(process.env.MIRA_BACKUP_SOURCE_URL??"",process.env.MIRA_BACKUP_OPERATOR_KEY,process.env.MIRA_BACKUP_SOURCE_OBJECT??"mira-production-v1");
const v2=call=>input=>call({...input,version:2});
let result;
if(command==="protect")result=await v2(source())({operation:"protect",writerId:archive,confirm:target});
else if(command==="backup-v2")result=await captureArchive(v2(source()),process.env.MIRA_BACKUP_DIRECTORY,key);
else if(command==="restore-v2")result=await restoreProtectedArchive(v2(operatorClient(process.env.MIRA_BACKUP_TARGET_URL??"",process.env.MIRA_BACKUP_OPERATOR_KEY,target)),archive,key,target);
else if(command==="backup")result=await captureArchive(source(),process.env.MIRA_BACKUP_DIRECTORY,key);
else if(command==="ledger")result=await captureArchive(source(),process.env.MIRA_LEDGER_DIRECTORY,key,"ledger");
else if(command==="verify")result=await verifyArchive(archive,key);
else if(command==="restore")result=await restoreArchive(source(),operatorClient(process.env.MIRA_BACKUP_TARGET_URL??process.env.MIRA_BACKUP_SOURCE_URL??"",process.env.MIRA_BACKUP_OPERATOR_KEY,target),archive,process.env.MIRA_LEDGER_DIRECTORY,key,target,confirmation);
else throw Error('Use protect <writer-ID> "ENABLE INDEPENDENT SUPPRESSION", backup-v2, restore-v2 <archive> <mira-recovery-ID>, backup, ledger, verify <archive>, or restore <archive> <mira-recovery-ID> "RETIRE mira-production-v1". No command changes routing.');
console.log(JSON.stringify(result.manifest?{verified:true,directory:result.directory,archiveId:result.manifest.archiveId,kind:result.manifest.kind,watermark:result.manifest.watermark,rows:result.manifest.totalRows,bytes:result.manifest.totalBytes}:result));
