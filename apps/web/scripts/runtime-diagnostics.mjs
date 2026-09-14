import {open,mkdir,writeFile} from "node:fs/promises";
import {join} from "node:path";

// Fatal Wrangler proxy errors close the HTTP listener before its CLI has
// finished flushing the debug queue. Do not snapshot that queue immediately
// after ECONNREFUSED, nor kill its process group before its natural exit.
export async function waitForRuntimeExit(child,timeoutMs=4000){
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>5000)throw new Error("Invalid runtime exit deadline");
  if(child.exitCode!==null||child.signalCode!==null)return true;
  return new Promise(resolve=>{
    const finish=exited=>{clearTimeout(timer);child.removeListener("close",closed);resolve(exited);};
    const closed=()=>finish(true);
    const timer=setTimeout(()=>finish(false),timeoutMs);
    child.once("close",closed);
  });
}

// Only for credential-isolated synthetic runtimes. Never copy a user's global
// Wrangler logs: callers supply the exact log created in their own mkdtemp.
export async function readLogTail(path,maxBytes=64*1024){
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>256*1024)throw new Error("Invalid diagnostic byte limit");
  let file;
  try{
    file=await open(path,"r");const stat=await file.stat();
    if(!stat.isFile())return {available:false,text:"",truncated:false};
    const length=Math.min(stat.size,maxBytes),buffer=Buffer.alloc(length);
    const {bytesRead}=await file.read(buffer,0,length,Math.max(0,stat.size-length));
    return {available:true,text:buffer.subarray(0,bytesRead).toString("utf8"),truncated:stat.size>maxBytes};
  }catch{return {available:false,text:"",truncated:false};}
  finally{await file?.close();}
}

export async function retainRuntimeFailure({directory,logPath,consoleTail,exitCode,signal}){
  const debug=await readLogTail(logPath);
  const report={schemaVersion:1,scope:"isolated-synthetic-runtime",at:new Date().toISOString(),exitCode:exitCode??null,signal:signal??null,consoleTail:String(consoleTail).slice(-16000),debug};
  await mkdir(directory,{recursive:true});
  await writeFile(join(directory,"runtime-diagnostics.json"),JSON.stringify(report,null,2),{mode:0o600});
  return report;
}
