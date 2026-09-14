import {readFile,writeFile,mkdir,mkdtemp} from "node:fs/promises";
import {createHash} from "node:crypto";
import {setTimeout as delay} from "node:timers/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {matchesReplyLanguage} from "../lib/reply-language.ts";

// Explicit operator authorization only. This script never defaults to a live
// target, manufactures consent, renews a limited session or retries inference.
// MAX_REQUESTS bounds chat HTTP requests, not a provider invoice: one accepted
// request may use the server's bounded quality-repair attempts and consume quota.
export const EVALUATION_POLICY_VERSION="2026-09-13";
const demoCookieName="__Host-mira_demo",accountCookieName="__Host-companaro_session";
const generic=/caught that wrong|heard (?:it|you) wrong|main point miss|few different things|more to go on|समझ नहीं|समझा नहीं|not sure what you mean/i;
const sha=value=>createHash("sha256").update(value).digest("hex");

export function evaluationOptions(env){
  let target;
  try{target=new URL(env.COMPANARO_URL);}catch{throw Error("Set COMPANARO_URL to the explicitly authorized origin.");}
  const loopback=["127.0.0.1","localhost","[::1]"].includes(target.hostname);
  if(target.username||target.password||target.search||target.hash||target.pathname!=="/"||(target.protocol!=="https:"&&!(loopback&&target.protocol==="http:")))throw Error("Evaluation requires an HTTPS origin (or HTTP loopback), without credentials, path, query or fragment.");
  if(env.MIRA_EVAL_ALLOW_PROVIDER_REQUESTS!=="true")throw Error("Set MIRA_EVAL_ALLOW_PROVIDER_REQUESTS=true only for authorized provider requests.");
  if(!/^[1-9][0-9]{0,2}$/.test(env.MIRA_EVAL_MAX_REQUESTS??"")||Number(env.MIRA_EVAL_MAX_REQUESTS)>100)throw Error("MIRA_EVAL_MAX_REQUESTS must be an explicit integer from 1 to 100.");
  if(env.MIRA_EVAL_POLICY_VERSION!==EVALUATION_POLICY_VERSION||env.MIRA_EVAL_ADULT_DECLARED!=="true"||env.MIRA_EVAL_AI_PROCESSING_CONSENT!=="true")throw Error("Explicit current policy, adult declaration and AI-processing consent are required.");
  const accountCookie=env.MIRA_EVAL_ACCOUNT_COOKIE;
  if(accountCookie!==undefined&&!new RegExp(`^${accountCookieName}=[A-Za-z0-9_-]{43}$`).test(accountCookie))throw Error("MIRA_EVAL_ACCOUNT_COOKIE must contain only the authorized account session cookie.");
  const scenarios=env.MIRA_EVAL_SCENARIOS?.split(",");
  if(scenarios&&(scenarios.length>50||new Set(scenarios).size!==scenarios.length||scenarios.some(id=>!/^[-a-z0-9]{1,100}$/.test(id))))throw Error("MIRA_EVAL_SCENARIOS must contain distinct comma-separated scenario IDs.");
  return {base:target.origin,maxRequests:Number(env.MIRA_EVAL_MAX_REQUESTS),accountCookie,scenarios,outputDirectory:env.QA_DIRECTORY?resolve(env.QA_DIRECTORY):undefined};
}

function selectDataset(dataset,ids){
  if(!Array.isArray(dataset)||!dataset.length||dataset.length>50)throw Error("The synthetic evaluation dataset is invalid.");
  const seen=new Set();
  for(const scenario of dataset){
    if(!scenario||!/^[-a-z0-9]{1,100}$/.test(scenario.id)||seen.has(scenario.id)||!Array.isArray(scenario.turns)||!scenario.turns.length||scenario.turns.length>24)throw Error("Invalid synthetic scenario.");
    seen.add(scenario.id);
    for(const turn of scenario.turns){
      if(!turn||typeof turn.text!=="string"||!turn.text.trim()||turn.text.length>8000||!["en","hi","hinglish"].includes(turn.language)||(turn.noQuestion!==undefined&&typeof turn.noQuestion!=="boolean")||(turn.anchors!==undefined&&(!Array.isArray(turn.anchors)||!turn.anchors.length||turn.anchors.length>20||turn.anchors.some(anchor=>typeof anchor!=="string"||!anchor||anchor.length>200))))throw Error("Invalid synthetic turn.");
      if(turn.anchorGroups!==undefined&&(!Array.isArray(turn.anchorGroups)||!turn.anchorGroups.length||turn.anchorGroups.length>8||turn.anchorGroups.some(group=>!Array.isArray(group)||!group.length||group.length>10||group.some(anchor=>typeof anchor!=="string"||!anchor||anchor.length>200))))throw Error("Invalid required synthetic facts.");
    }
  }
  if(ids?.some(id=>!seen.has(id)))throw Error("An explicitly selected scenario is not in the synthetic dataset.");
  return ids?ids.map(id=>dataset.find(scenario=>scenario.id===id)):dataset;
}

/** Same review heuristics as the source dataset's original evaluator. A pass is
 * not a semantic-quality score; exact synthetic content stays in memory only. */
export function evaluateTurn(turn,reply,status=200){
  const languageOk=matchesReplyLanguage(reply,turn.language);
  const contains=anchor=>reply.toLowerCase().includes(anchor.toLowerCase());
  const anchorsOk=(!turn.anchors||turn.anchors.some(contains))&&(!turn.anchorGroups||turn.anchorGroups.every(group=>group.some(contains)));
  return [...(status!==200||!reply.trim()?["service-error"]:[]),...(!languageOk?["language"]:[]),...(generic.test(reply)?["generic-misunderstanding"]:[]),...(!anchorsOk?["context-anchor-review"]:[]),...(turn.noQuestion&&reply.includes("?")?["unwanted-question"]:[])];
}

class EvaluationFailure extends Error{
  constructor(code,status=0){super(code);this.code=code;this.status=status;}
}
const knownErrorCodes=new Set(["DEMO_SESSION_REQUIRED","DEMO_SESSION_EXPIRED","DEMO_SESSION_LIMIT","SESSION_EXPIRED","CONSENT_REQUIRED","POLICY_CONFIRMATION_REQUIRED","DAILY_CAPACITY_EXHAUSTED","INFERENCE_BUSY","PROVIDER_UNAVAILABLE","PROVIDER_TIMEOUT","SERVICE_UNAVAILABLE","INFERENCE_DISABLED","RATE_LIMITED","INPUT_TOO_LARGE","INVALID_REQUEST","INVALID_REPLY","UNSAFE_STREAM","CONTEXT_CHANGED"]);
function failureCode(body,fallback){return knownErrorCodes.has(body?.code)?body.code:fallback;}
async function boundedJson(fetchImpl,url,init){
  const abort=new AbortController();let reader,timer;
  const work=async()=>{
    const response=await fetchImpl(url,{...init,redirect:"error",signal:abort.signal});
    if(response.status>=300&&response.status<400)throw new EvaluationFailure("REDIRECT_REJECTED",response.status);
    const length=Number(response.headers.get("content-length")??0);
    if(length>32768)throw new EvaluationFailure("RESPONSE_TOO_LARGE",response.status);
    reader=response.body?.getReader();if(!reader)throw new EvaluationFailure("INVALID_RESPONSE",response.status);
    const decoder=new TextDecoder();let text="",bytes=0,chunks=0;
    for(;;){const item=await reader.read();if(item.done)break;bytes+=item.value.byteLength;if(bytes>32768||++chunks>512)throw new EvaluationFailure("RESPONSE_TOO_LARGE",response.status);text+=decoder.decode(item.value,{stream:true});}
    let body;try{body=JSON.parse(text+decoder.decode());}catch{throw new EvaluationFailure("INVALID_RESPONSE",response.status);}
    if(!body||typeof body!=="object"||Array.isArray(body))throw new EvaluationFailure("INVALID_RESPONSE",response.status);
    return {response,body};
  };
  try{return await Promise.race([work(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new EvaluationFailure("REQUEST_TIMEOUT")),15000);})]);}
  catch(error){throw error instanceof EvaluationFailure?error:new EvaluationFailure("REQUEST_FAILED");}
  finally{clearTimeout(timer);abort.abort();void reader?.cancel().catch(()=>undefined);}
}
function release(body){
  if(!/^[0-9a-f-]{36}$/i.test(body.versionId??""))throw new EvaluationFailure("RELEASE_ID_MISSING");
  if(!/^[0-9a-f]{40}$/.test(body.commitSha??""))throw new EvaluationFailure("RELEASE_SHA_MISSING");
  return {versionId:body.versionId,commitSha:body.commitSha};
}

/** Dependency injection supports isolated tests; the CLI always uses native
 * fetch and the checked-in synthetic dataset, never arbitrary user histories. */
export async function runConversationEvaluation(env,dataset,{fetchImpl=fetch,sleep=delay,now=()=>performance.now()}={}){
  // Every option and scenario is checked before health, consent or provider I/O.
  const options=evaluationOptions(env),selected=selectDataset(dataset,options.scenarios);
  const report={at:new Date().toISOString(),base:options.base,kind:"Synthetic text inputs through the shared voice/video reply API. Language/anchors are review heuristics, not human microphone, semantic-quality or acoustic acceptance.",requestedTurns:selected.reduce((sum,scenario)=>sum+scenario.turns.length,0),maxRequests:options.maxRequests,budgetScope:"Client chat HTTP requests, charged before dispatch without retries/refunds. Upstream model attempts and credit use are unknown; an API request may perform normal plus repair attempts. No free-quota guarantee.",upstreamProviderAttempts:null,sessionMode:options.accountCookie?"account":"demo",total:0,passed:0,complete:false,stableDeployment:false,startingVersion:null,endingVersion:null,startingCommit:null,endingCommit:null,stopReason:null,sessionRevoked:null,results:[]};
  let sessionCookie=options.accountCookie??"",ownedDemo=false,stage="health";
  const request=(path,init={})=>boundedJson(fetchImpl,`${options.base}${path}`,{...init,headers:{origin:options.base,...(sessionCookie?{cookie:sessionCookie}:{}),...init.headers}});
  try{
    const initial=await request("/api/health");if(initial.response.status!==200)throw new EvaluationFailure("HEALTH_UNAVAILABLE",initial.response.status);
    const start=release(initial.body);report.startingVersion=start.versionId;report.startingCommit=start.commitSha;
    if(!options.accountCookie){
      stage="session";
      const session=await request("/api/demo/session",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({adultDeclared:true,aiProcessingConsent:true,memoryConsent:false,policyVersion:EVALUATION_POLICY_VERSION})});
      if(session.response.status!==201)throw new EvaluationFailure(failureCode(session.body,"SESSION_FAILED"),session.response.status);
      // Accept exactly this host-only secure cookie; reject Domain/path changes
      // and never forward arbitrary Set-Cookie headers to another endpoint.
      const cookies=session.response.headers.getSetCookie();
      const matches=cookies.filter(value=>value.startsWith(`${demoCookieName}=`));
      if(matches.length!==1)throw new EvaluationFailure("SESSION_COOKIE_INVALID");
      const parts=matches[0].split(";").map(part=>part.trim());
      if(!new RegExp(`^${demoCookieName}=[A-Za-z0-9_-]{43}$`).test(parts[0])||parts.some(part=>/^domain=/i.test(part))||!parts.some(part=>/^path=\/$/i.test(part))||!parts.some(part=>/^secure$/i.test(part))||!parts.some(part=>/^httponly$/i.test(part))||!parts.some(part=>/^samesite=strict$/i.test(part)))throw new EvaluationFailure("SESSION_COOKIE_INVALID");
      sessionCookie=parts[0];ownedDemo=true;
      if(session.body.mode!=="demo"||session.body.policyVersion!==EVALUATION_POLICY_VERSION||!Number.isFinite(Date.parse(session.body.expiresAt))||Date.parse(session.body.expiresAt)<=Date.now())throw new EvaluationFailure("SESSION_POLICY_INVALID");
    }
    outer:for(const scenario of selected){
      const messages=[];
      for(let turnIndex=0;turnIndex<scenario.turns.length;turnIndex++){
        if(report.total>=options.maxRequests){report.stopReason="REQUEST_BUDGET_EXHAUSTED";break outer;}
        const turn=scenario.turns[turnIndex];messages.push({role:"user",content:turn.text});
        stage="provider";const started=now();const delivery=report.total%2?"video":"voice";
        // Charge before dispatch. Failures/cancellation consume the request cap.
        report.total++;
        let reply="",status=0,error="",provider="unknown";
        try{
          const result=await request("/api/companion-chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({messages,companion:{name:"Mira"},user:{name:"Synthetic QA"},delivery})});
          status=result.response.status;
          if(status!==200)throw new EvaluationFailure(failureCode(result.body,"PROVIDER_ERROR"),status);
          if(typeof result.body.reply!=="string"||!result.body.reply.trim()||result.body.reply.length>8000)throw new EvaluationFailure("INVALID_REPLY",status);
          reply=result.body.reply;
          // Record a bounded provider family, not arbitrary echoed metadata.
          provider=String(result.body.provider??result.body.model??result.body.source??"").startsWith("@cf/")?"cloudflare":"reported";
        }catch(cause){error=cause instanceof EvaluationFailure?cause.code:"REQUEST_FAILED";status=cause instanceof EvaluationFailure?cause.status:0;}
        const flags=evaluateTurn(turn,reply,status),latencyMs=Math.max(0,Math.round(now()-started));
        report.results.push({scenario:scenario.id,turn:turnIndex+1,expectedLanguage:turn.language,delivery,inputSha256:sha(turn.text),replySha256:reply?sha(reply):null,replyCharacters:reply.length,provider,status,latencyMs,flags,error});
        if(!flags.length&&!error)report.passed++;
        if(error){report.stopReason=error;break outer;}
        messages.push({role:"assistant",content:reply});
        if(report.total<report.requestedTurns&&report.total<options.maxRequests)await sleep(Math.max(0,2700-latencyMs));
      }
    }
    stage="health";
    const final=await request("/api/health");if(final.response.status!==200)throw new EvaluationFailure("HEALTH_UNAVAILABLE",final.response.status);
    const end=release(final.body);report.endingVersion=end.versionId;report.endingCommit=end.commitSha;
    report.stableDeployment=report.startingVersion===report.endingVersion&&report.startingCommit===report.endingCommit;
    if(!report.stableDeployment)report.stopReason="DEPLOYMENT_CHANGED";
  }catch(cause){report.stopReason=cause instanceof EvaluationFailure?cause.code:"EVALUATION_FAILED";report.failureStage=stage;}
  finally{
    if(ownedDemo){
      try{const revoked=await request("/api/demo/session",{method:"DELETE"});report.sessionRevoked=revoked.response.status===200&&revoked.body.revoked===true;}catch{report.sessionRevoked=false;}
      if(!report.sessionRevoked&&!report.stopReason)report.stopReason="SESSION_REVOCATION_FAILED";
    }
    // No cookie is returned, logged or written; supplied account sessions are
    // neither renewed nor revoked. Newly issued demos are revoked best-effort.
    sessionCookie="";
  }
  const sorted=report.results.map(result=>result.latencyMs).sort((a,b)=>a-b);
  report.p50Ms=sorted.length?sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.5))]:null;
  report.p95Ms=sorted.length?sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))]:null;
  report.p99Ms=sorted.length?sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.99))]:null;
  report.genericMisunderstandingRate=report.total?report.results.filter(result=>result.flags.includes("generic-misunderstanding")).length/report.total:null;
  report.languages=Object.fromEntries(["en","hi","hinglish"].map(language=>{
    const turns=report.results.filter(result=>result.expectedLanguage===language),latencies=turns.map(result=>result.latencyMs).sort((a,b)=>a-b);
    return [language,{turns:turns.length,passed:turns.filter(result=>!result.flags.length&&!result.error).length,p50Ms:latencies.length?latencies[Math.floor(latencies.length*.5)]:null,p95Ms:latencies.length?latencies[Math.min(latencies.length-1,Math.floor(latencies.length*.95))]:null}];
  }));
  report.complete=!report.stopReason&&report.total===report.requestedTurns&&report.stableDeployment;
  report.success=report.complete&&report.passed===report.total;
  return report;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const options=evaluationOptions(process.env);
    const dataset=JSON.parse(await readFile(new URL("../evals/conversations.json",import.meta.url),"utf8"));
    const report=await runConversationEvaluation(process.env,dataset);
    const directory=options.outputDirectory??await mkdtemp(join(tmpdir(),"mira-conversation-eval-"));
    await mkdir(directory,{recursive:true});
    await writeFile(join(directory,"conversation-eval.json"),JSON.stringify(report,null,2),{flag:"wx",mode:0o600});
    console.log(JSON.stringify({reportDirectory:directory,complete:report.complete,success:report.success,total:report.total,passed:report.passed,stopReason:report.stopReason}));
    if(!report.success)process.exitCode=1;
  }catch{console.error("Evaluation did not run or could not save evidence. Check the explicit target, authorization, current consent, request budget and unused output directory; no credential values are logged.");process.exitCode=1;}
}
