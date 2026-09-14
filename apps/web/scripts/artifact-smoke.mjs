import {mkdtemp,writeFile,readdir,readFile,mkdir} from "node:fs/promises";
import {createHash} from "node:crypto";
import {tmpdir} from "node:os";
import {resolve,join} from "node:path";
import {spawn} from "node:child_process";
import {retainRuntimeFailure,waitForRuntimeExit} from "./runtime-diagnostics.mjs";
import {verifyRuntimeCadence} from "./runtime-cadence.mjs";

// Execute the already-built bytes, without rebundling or touching the sealed
// production config. Persistence and env-file are unique/empty. The runtime
// blocks external egress and its kill switch explicitly refuses inference.
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
const server=spawn(process.execPath,[join(web,"scripts/built-artifact-runtime.mjs"),join(web,"dist/server/wrangler.json"),directory,"4398"],{cwd:web,env,stdio:["ignore","pipe","pipe"],detached:process.platform!=="win32"});
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
  // Rejected POSTs still own request streams. Exercise successive small/large
  // bodies before GETs: an unread body can poison the local proxy connection.
  const inferenceRoutes=["companion-chat","companion-speech","companion-transcribe","companion-memory"];
  for(let probe=0;probe<24;probe++){
    const route=inferenceRoutes[probe%inferenceRoutes.length];
    const denied=await fetch(`${base}/api/${route}`,{method:"POST",headers:{"content-type":"application/json",origin:base},body:Math.floor(probe/inferenceRoutes.length)%2?JSON.stringify({synthetic:"x".repeat(8192)}):"{}",signal:AbortSignal.timeout(5000)});
    const deniedBody=await denied.json();
    if(denied.status!==503||deniedBody.code!=="INFERENCE_DISABLED")throw new Error("Local artifact did not refuse external inference");
  }
  console.log("24 rejected POST bodies: expected inference-disabled responses, zero inference calls.");
  const chunks=join(web,"dist/client/_next/static/chunks");
  const moduleName=(await readdir(chunks)).filter(name=>name.endsWith(".js")).sort()[0];
  if(!moduleName)throw new Error("Compiled artifact has no JavaScript asset for timing regression");
  const expectedSha256=createHash("sha256").update(await readFile(join(chunks,moduleName))).digest("hex");
  const cadence=[];
  await mkdir(evidence,{recursive:true});
  try{
    await verifyRuntimeCadence({url:`${base}/_next/static/chunks/${moduleName}`,expectedSha256,
      onResult:result=>{cadence.push(result);console.log(`Compiled-byte cadence ${JSON.stringify(result)}`);}});
  }finally{
    await writeFile(join(evidence,"runtime-cadence.json"),JSON.stringify({scope:"isolated-compiled-artifact",intervalMs:5000,retries:0,expectedSha256,results:cadence},null,2));
  }
  const smoke=spawn(process.execPath,[join(web,"scripts/production-smoke.mjs")],{cwd:resolve(web,"../.."),env:{...env,COMPANARO_URL:base,MIRA_EXPECTED_SHA:process.env.GITHUB_SHA??"unreleased",MIRA_SYNTHETIC_DIAGNOSTICS:"true",QA_DIRECTORY:evidence},stdio:"inherit"});
  const code=await new Promise((resolve,reject)=>{smoke.on("error",reject);smoke.on("exit",resolve);});
  // This server has isolated synthetic credentials and no real user requests.
  // Retain its bounded diagnostics on failure: otherwise a workerd exit after
  // readiness looks like unexplained page failures and hides the release cause.
  if(code!==0)throw new Error(`Local built-artifact smoke failed (${code}); server exit=${server.exitCode}, signal=${server.signalCode}: ${output}`);
  // A successful last HTTP response must not hide an already-failed runtime.
  // Let pending child lifecycle events settle before authorizing shutdown.
  await new Promise(resolve=>setImmediate(resolve));
  if(spawnError||server.exitCode!==null||server.signalCode!==null)throw new Error(`Artifact runtime failed before verification completed: exit=${server.exitCode}, signal=${server.signalCode}`);
  console.log(`Built artifact executed locally; isolated state retained at ${directory}. No live deployment/provider calls.`);
}catch(error){
  // Wrangler can render a blank Error.message while its debug file contains the
  // stack/cause. Keep that bounded log from THIS isolated process only. Console
  // level need not be debug; Wrangler writes debug records to disk by default.
  try{
    await waitForRuntimeExit(server);
    await retainRuntimeFailure({directory:evidence,logPath:debugLog,consoleTail:output,exitCode:server.exitCode,signal:server.signalCode});
    console.error(`Isolated runtime diagnostics retained at ${join(evidence,"runtime-diagnostics.json")}`);
  }catch{console.error("Could not retain isolated runtime diagnostics; original failure follows.");}
  throw error;
}finally{
  if(server.pid){try{if(process.platform!=="win32")process.kill(-server.pid,"SIGTERM");else server.kill("SIGTERM");}catch{/* Already exited. */}}
  await waitForRuntimeExit(server);
}
