import {mkdtemp,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {resolve,join} from "node:path";
import {spawn} from "node:child_process";
import {retainRuntimeFailure} from "./runtime-diagnostics.mjs";

// Execute the already-built bytes, without rebundling or touching the sealed
// production config. Persistence and env-file are unique/empty. --local alone
// does not isolate AI: the runtime kill switch explicitly refuses inference.
const directory=await mkdtemp(join(tmpdir(),"mira-artifact-smoke-"));
const emptyEnv=join(directory,"empty.env");
await writeFile(emptyEnv,"# Intentionally no credentials\n");
const web=resolve(import.meta.dirname,"..");
const base="http://127.0.0.1:4398";
const debugLog=join(directory,"wrangler.log");
const evidence=process.env.QA_DIRECTORY??join(directory,"evidence");
const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,
  XDG_CONFIG_HOME:join(directory,"config"),XDG_CACHE_HOME:join(directory,"cache"),
  // Wrangler may prefer an existing ~/.wrangler over XDG for its registry.
  WRANGLER_REGISTRY_PATH:join(directory,"registry"),
  WRANGLER_LOG_PATH:debugLog,WRANGLER_WRITE_LOGS:"true",WRANGLER_LOG_SANITIZE:"true",
  CLOUDFLARE_API_TOKEN:"mira-synthetic-only-no-cloud-access",
  CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:"false",WRANGLER_SEND_METRICS:"false",CI:"true"};
let output="";
const server=spawn(process.execPath,[join(web,"node_modules/wrangler/bin/wrangler.js"),"dev","--config","dist/server/wrangler.json","--local","--no-bundle","--ip","127.0.0.1","--port","4398","--inspector-port","0","--persist-to",join(directory,"state"),"--env-file",emptyEnv,"--var","MIRA_INFERENCE_DISABLED:true"],{cwd:web,env,stdio:["ignore","pipe","pipe"],detached:process.platform!=="win32"});
server.stdout.on("data",chunk=>{output=(output+chunk).slice(-16000);});
server.stderr.on("data",chunk=>{output=(output+chunk).slice(-16000);});
let spawnError;
server.on("error",error=>{spawnError=error;});
try{
  let ready=false;
  for(let i=0;i<120;i++){
    if(spawnError)throw spawnError;
    if(server.exitCode!==null)throw new Error(`Local artifact server exited ${server.exitCode}: ${output}`);
    // Do not mistake an unrelated process already using this port for our build.
    if(output.includes(`Ready on ${base}`))try{const response=await fetch(`${base}/api/health`,{signal:AbortSignal.timeout(1000)});await response.arrayBuffer();if(response.ok&&server.exitCode===null){ready=true;break;}}catch{/* Bounded startup only. */}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  if(!ready)throw new Error(`Local artifact failed readiness: ${output}`);
  // Probe the server boundary, not merely the browser mocks or credential absence.
  const denied=await fetch(`${base}/api/companion-chat`,{method:"POST",headers:{"content-type":"application/json",origin:base},body:"{}",signal:AbortSignal.timeout(5000)});
  const deniedBody=await denied.json();
  if(denied.status!==503||deniedBody.code!=="INFERENCE_DISABLED")throw new Error("Local artifact did not refuse external inference");
  const smoke=spawn(process.execPath,[join(web,"scripts/production-smoke.mjs")],{cwd:resolve(web,"../.."),env:{...env,COMPANARO_URL:base,MIRA_EXPECTED_SHA:process.env.GITHUB_SHA??"unreleased",QA_DIRECTORY:evidence},stdio:"inherit"});
  const code=await new Promise((resolve,reject)=>{smoke.on("error",reject);smoke.on("exit",resolve);});
  // This server has isolated synthetic credentials and no real user requests.
  // Retain its bounded diagnostics on failure: otherwise a workerd exit after
  // readiness looks like unexplained page failures and hides the release cause.
  if(code!==0)throw new Error(`Local built-artifact smoke failed (${code}); server exit=${server.exitCode}, signal=${server.signalCode}: ${output}`);
  console.log(`Built artifact executed locally; isolated state retained at ${directory}. No live deployment/provider calls.`);
}catch(error){
  // Wrangler can render a blank Error.message while its debug file contains the
  // stack/cause. Keep that bounded log from THIS isolated process only. Console
  // level need not be debug; Wrangler writes debug records to disk by default.
  try{
    const report=await retainRuntimeFailure({directory:evidence,logPath:debugLog,consoleTail:output,exitCode:server.exitCode,signal:server.signalCode});
    console.error(`Isolated runtime debug log (${report.debug.truncated?"tail":"complete"}):\n${report.debug.text||"unavailable"}`);
  }catch{console.error("Could not retain isolated runtime diagnostics; original failure follows.");}
  throw error;
}finally{
  if(server.pid){try{if(process.platform!=="win32")process.kill(-server.pid,"SIGTERM");else server.kill("SIGTERM");}catch{/* Already exited. */}}
}
