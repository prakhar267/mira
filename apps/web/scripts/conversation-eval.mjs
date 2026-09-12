import {readFile,writeFile,mkdir} from "node:fs/promises";
import {setTimeout as delay} from "node:timers/promises";
const base=(process.env.COMPANARO_URL||"https://luma-companion.prakhargupta267.workers.dev").replace(/\/$/,"");
const dataset=JSON.parse(await readFile(new URL("../evals/conversations.json",import.meta.url),"utf8"));
const startingVersion=(await(await fetch(`${base}/api/health`)).json()).versionId;
const results=[];
const generic=/caught that wrong|heard (?:it|you) wrong|main point miss|few different things|more to go on|समझ नहीं|समझा नहीं|not sure what you mean/i;
for(const scenario of dataset){
  const messages=[];
  for(const turn of scenario.turns){
    messages.push({role:"user",content:turn.text});
    const start=performance.now();let reply="",provider="",status=0,error="";
    try{const response=await fetch(`${base}/api/companion-chat`,{method:"POST",headers:{"content-type":"application/json",origin:base},body:JSON.stringify({messages,companion:{name:"Mira"},user:{name:"QA"},delivery:results.length%2?"video":"voice"}),signal:AbortSignal.timeout(15000)});status=response.status;const body=await response.json();reply=body.reply??"";provider=body.provider??body.model??body.source??"unknown";error=body.error??"";}catch(e){error=e.message;}
    const ms=Math.round(performance.now()-start);
    const hindi=/\p{Script=Devanagari}/u.test(reply);
    const romanHindi=/\b(?:haan|hai|hoon|tum|aaj|kya|kar|karo|yaar|mujhe|nahi|accha|kaafi|bilkul|batao|toh|usko|uske|ek|main|aur|phir|pasand|chahiye|wahan|kal|saath|liye|rakh|rakho|hoga|hum|tujhe|kaam|chalo|tumhe|tumhari|bolo|mat|bas)\b/i.test(reply);
    const languageOk=turn.language==="hi"?hindi:turn.language==="hinglish"?!hindi&&romanHindi:!hindi;
    const anchorsOk=!turn.anchors||turn.anchors.some(a=>reply.toLowerCase().includes(a.toLowerCase()));
    const flags=[...(status!==200?["service-error"]:[]),...(!languageOk?["language"]:[]),...(generic.test(reply)?["generic-misunderstanding"]:[]),...(!anchorsOk?["context-anchor-review"]:[]),...(turn.noQuestion&&reply.includes("?")?["unwanted-question"]:[])];
    results.push({scenario:scenario.id,input:turn.text,expectedLanguage:turn.language,reply,provider,status,latencyMs:ms,flags,error});
    if(reply)messages.push({role:"assistant",content:reply});
    console.log(`${results.length}: ${scenario.id} ${ms}ms ${flags.length?flags.join(","):"PASS"}`);
    await delay(Math.max(0,2700-ms));
  }
}
const sorted=results.map(r=>r.latencyMs).sort((a,b)=>a-b);
const endingVersion=(await(await fetch(`${base}/api/health`)).json()).versionId;
const report={at:new Date().toISOString(),base,startingVersion,endingVersion,stableDeployment:startingVersion===endingVersion,kind:"Scripted text inputs through the shared voice/video reply API; language/anchors are heuristic flags for human review, NOT human microphone testing or a subjective quality score",total:results.length,passed:results.filter(r=>!r.flags.length).length,p50Ms:sorted[Math.floor(sorted.length*.5)],p95Ms:sorted[Math.floor(sorted.length*.95)],genericMisunderstandingRate:results.filter(r=>r.flags.includes("generic-misunderstanding")).length/results.length,results};
const directory=new URL(process.env.QA_DIRECTORY||"audit/2026-09-12-launch/",new URL("../../../",import.meta.url));await mkdir(directory,{recursive:true});await writeFile(new URL("conversation-eval.json",directory),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,results:undefined},null,2));if(report.passed<report.total||!report.stableDeployment)process.exitCode=1;
