import {mkdir,writeFile} from "node:fs/promises";
import {resolve} from "node:path";

// Promotion smoke is read-only: no synthetic account creation, inference calls,
// email or real conversations. Provider-backed evaluation is a separate gate.
const baseUrl=(process.env.COMPANARO_URL||"https://luma-companion.prakhargupta267.workers.dev").replace(/\/$/,"");
const results=[];
let versionId=null;
const check=(condition,message)=>{if(!condition)throw new Error(message);};
const request=async(path,init={})=>fetch(`${baseUrl}${path}`,{...init,signal:AbortSignal.timeout(20_000)});
const run=async(name,task)=>{try{const detail=await task();results.push({name,passed:true,detail});console.log(`PASS ${name} — ${detail}`);}catch(error){const detail=error instanceof Error?error.message:"Check failed";results.push({name,passed:false,detail});console.log(`FAIL ${name} — ${detail}`);}};

await run("public site and security headers",async()=>{
  const response=await request("/");await response.arrayBuffer();
  check(response.ok,`home HTTP ${response.status}`);
  check(response.headers.get("content-security-policy")?.includes("default-src 'self'"),"CSP missing");
  check(response.headers.get("strict-transport-security")?.includes("max-age=63072000"),"HSTS missing");
  check(response.headers.get("x-frame-options")==="DENY","frame protection missing");
  return "application reachable; CSP/HSTS/frame protection present";
});
await run("public free-beta pages",async()=>{
  for(const path of ["/demo","/login","/forgot-password","/pricing","/support","/privacy","/terms"]){
    const response=await request(path);const html=await response.text();
    check(response.ok,`${path}: HTTP ${response.status}`);
    if(path==="/pricing")check(/free public beta/i.test(html),"free-beta pricing disclosure missing");
  }
  return "demo, account entry, recovery and disclosures reachable";
});
await run("account-page boundary",async()=>{
  const response=await request("/app",{redirect:"manual"});await response.arrayBuffer();
  check(response.status>=300&&response.status<400&&response.headers.get("location")?.endsWith("/login"),`unauthenticated app: HTTP ${response.status}`);
  return "redirects unauthenticated page to login; API boundaries covered in Worker suite";
});
await run("operational health and exact release correlation",async()=>{
  const response=await request("/api/health");const body=await response.json();
  check(response.ok&&body.status==="ok",`health HTTP ${response.status}`);
  check(body.services?.accountStorage==="sqlite-reachable","database not reachable");
  check(body.services?.inference==="configured-not-probed","AI binding absent");
  if(process.env.MIRA_EXPECTED_SHA)check(body.commitSha===process.env.MIRA_EXPECTED_SHA,"deployed commit does not match promoted artifact");
  versionId=body.versionId??null;
  return `Worker version ${versionId}; commit ${body.commitSha??"not reported"}; inference not probed`;
});
await run("avatar asset availability",async()=>{
  const response=await request("/assets/mira/avatar/mira-anime-live-v2.vrm");
  check(response.ok,`avatar HTTP ${response.status}`);
  // Streaming/local asset responses need not include Content-Length. Inspect
  // actual GLB/VRM bytes instead of treating that optional header as file size.
  const bytes=new Uint8Array(await response.arrayBuffer());
  check(bytes.length>1_000_000&&new TextDecoder().decode(bytes.slice(0,4))==="glTF","avatar response is not the expected GLB/VRM asset");
  return "asset reachable; no claim about frame rate or lip sync";
});

const failed=results.filter(result=>!result.passed).length;
const directory=resolve(process.env.QA_DIRECTORY??`audit/release-${new Date().toISOString().replace(/[:.]/g,"-")}`);
await mkdir(directory,{recursive:true});
await writeFile(resolve(directory,"production-smoke.json"),JSON.stringify({
  at:new Date().toISOString(),baseUrl,versionId,expectedCommit:process.env.MIRA_EXPECTED_SHA??null,
  providerRequests:0,accountMutations:0,
  unverified:["provider response quality","physical microphone/playback","email and alert delivery"],
  passed:results.length-failed,total:results.length,results
},null,2));
console.log(`${results.length-failed}/${results.length} checks passed. Evidence: ${directory}`);
if(failed)process.exitCode=1;
