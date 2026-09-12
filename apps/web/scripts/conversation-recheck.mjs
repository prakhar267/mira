import {readFile,writeFile} from "node:fs/promises";
import {setTimeout as delay} from "node:timers/promises";
const directory=new URL("../../../audit/2026-09-12-followup/final/",import.meta.url);
const previous=JSON.parse(await readFile(new URL("conversation-eval.json",directory),"utf8"));
const base=previous.base;
const inputs=["मेरे पास सिर्फ आलू, चावल और दही है","yaar kal mera presentation hai, nahi sorry parso hai","Keep the plan simple, we are not trying to see everything","Meri behen Riya kal Delhi gayi thi. Mera bhai Aman abhi Mumbai mein hai."];
const startingVersion=(await(await fetch(base+"/api/health")).json()).versionId;
const results=[];
for(const input of inputs){
  const index=previous.results.findIndex(row=>row.input===input),target=previous.results[index];
  const messages=previous.results.slice(0,index).filter(row=>row.scenario===target.scenario).flatMap(row=>[{role:"user",content:row.input},...(row.reply?[{role:"assistant",content:row.reply}]:[])]);
  messages.push({role:"user",content:input});
  for(const delivery of ["voice","video"]){
    const start=performance.now();let reply="",status=0,error="";
    try{const response=await fetch(base+"/api/companion-chat",{method:"POST",headers:{"content-type":"application/json",origin:base},body:JSON.stringify({messages,companion:{name:"Mira"},user:{name:"QA"},delivery}),signal:AbortSignal.timeout(15000)});status=response.status;const body=await response.json();reply=body.reply??"";error=body.error??"";}catch(e){error=e.message;}
    const devanagari=/\p{Script=Devanagari}/u.test(reply);
    const hindiWords=(reply.match(/\b(?:aaj|abhi|hoon|haan|hai|hain|mujhe|tum|tumhe|tumhara|tumhari|kaafi|nahi|nahin|yaar|karti|rahi|aap|dono|bhi|rahega|rahegi|karoge|karogi|waapas|aaoge|thakaan|hoga|hogi|accha|kaise|kya|aur)\b/gi)?.length??0);
    const languageOk=target.expectedLanguage==="hi"?devanagari:target.expectedLanguage==="en"?!devanagari&&hindiWords<2:!devanagari&&hindiWords>0;
    const latencyMs=Math.round(performance.now()-start),passed=status===200&&languageOk;
    results.push({input,delivery,reply,status,error,latencyMs,languageOk,passed});
    console.log(`${passed?"PASS":"FAIL"} ${delivery} ${latencyMs}ms: ${input}`);
    await delay(Math.max(0,3000-latencyMs));
  }
}
const endingVersion=(await(await fetch(base+"/api/health")).json()).versionId;
const report={at:new Date().toISOString(),startingVersion,endingVersion,stableDeployment:startingVersion===endingVersion,scope:"Targeted API recheck of the failed turns plus manually found English-script leak and mixed-person regression, with preserved synthetic history in both voice and video delivery. Not a full-dataset rerun or physical microphone test.",passed:results.filter(r=>r.passed).length,total:results.length,results};
await writeFile(new URL("conversation-recheck.json",directory),JSON.stringify(report,null,2));if(report.passed!==report.total||!report.stableDeployment)process.exitCode=1;
