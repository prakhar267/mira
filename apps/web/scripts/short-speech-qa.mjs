import assert from "node:assert/strict";
import {mkdtemp,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

// Finite opt-in diagnostic. Only fictional fixed text is synthesized; clips
// are retained so a mismatch cannot be attributed to STT without listening.
assert.equal(process.env.MIRA_LIVE_QA,"true","Explicit live-provider authorization required");
const base=process.env.COMPANARO_URL,sha=process.env.MIRA_EXPECTED_SHA;
assert.equal(base,"https://luma-companion.prakhargupta267.workers.dev");
assert.match(sha??"",/^[a-f0-9]{40}$/);
assert.ok(process.argv.slice(2).every(value=>value==="--sentence-boundary"),"Unknown diagnostic option");
const cases=[
  {id:"no-hindi",text:"नहीं",expected:["नहीं","नही","nahi","nahin"]},
  {id:"city-roman",text:"Pune",expected:["pune","पुणे"]},
  {id:"city-devanagari",text:"पुणे",expected:["pune","पुणे"]},
  {id:"number-one",text:"one",expected:["one","1","वन","एक"]},
  {id:"english-choice",text:"English",expected:["english","इंग्लिश","अंग्रेजी","अंग्रेज़ी"]},
];
if(process.argv.includes("--sentence-boundary"))cases.splice(0,cases.length,
  {id:"city-roman-sentence",text:"Pune.",expected:["pune","पुणे"]},
  {id:"city-devanagari-sentence",text:"पुणे।",expected:["pune","पुणे"]});
const directory=await mkdtemp(join(tmpdir(),"mira-short-speech-"));
const report={at:new Date().toISOString(),expectedSha:sha,
  method:"Fixed synthetic Priya clips through production TTS and STT, audio retained. No actual microphone/VAD, acoustic or subjective voice acceptance. A mismatch does not by itself isolate TTS from STT.",
  variant:process.argv.includes("--sentence-boundary")?"two city names with sentence punctuation":"five isolated words",
  caps:{speech:cases.length,transcribe:cases.length},requests:{speech:0,transcribe:0},turns:[],sessionRevoked:false,passed:false};
let cookie="";
const request=(path,options={})=>fetch(`${base}${path}`,{...options,redirect:"error",headers:{origin:base,...(cookie?{cookie}:{}),...options.headers},signal:AbortSignal.timeout(15000)});
const post=(path,body)=>request(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
const health=async()=>{const r=await request("/api/health");assert.equal(r.status,200);const b=await r.json();assert.equal(b.commitSha,sha);return {sha:b.commitSha,versionId:b.versionId};};
try {
  report.before=await health();
  const session=await post("/api/demo/session",{adultDeclared:true,aiProcessingConsent:true,memoryConsent:false,policyVersion:"2026-09-13"});
  assert.equal(session.status,201);
  const cookies=session.headers.getSetCookie().filter(value=>value.startsWith("__Host-mira_demo="));
  assert.equal(cookies.length,1);
  const parts=cookies[0].split(";").map(part=>part.trim());
  assert.match(parts[0],/^__Host-mira_demo=[A-Za-z0-9_-]{43}$/);
  assert.ok(!parts.some(part=>/^domain=/i.test(part))&&["Path=/","Secure","HttpOnly","SameSite=Strict"].every(expected=>parts.some(part=>part.toLowerCase()===expected.toLowerCase())));
  cookie=parts[0];await session.arrayBuffer();
  for(const item of cases){
    const turn={id:item.id,reference:item.text,passed:false};report.turns.push(turn);
    assert.ok(++report.requests.speech<=report.caps.speech);
    const start=performance.now(),speech=await post("/api/companion-speech",{text:item.text});
    turn.speechStatus=speech.status;assert.equal(speech.status,200);
    turn.voice=speech.headers.get("x-companion-voice");assert.equal(turn.voice,"Priya");
    assert.ok(speech.headers.get("content-type")?.startsWith("audio/"));
    const bytes=Buffer.from(await speech.arrayBuffer());assert.ok(bytes.length>100&&bytes.length<3_000_000);
    turn.speechMs=Math.round(performance.now()-start);
    await writeFile(join(directory,`${item.id}.mp3`),bytes,{flag:"wx",mode:0o600});
    assert.ok(++report.requests.transcribe<=report.caps.transcribe);
    const st=performance.now(),response=await post("/api/companion-transcribe",{audioBase64:bytes.toString("base64"),contentType:"audio/mpeg"});
    turn.transcribeStatus=response.status;turn.transcribeMs=Math.round(performance.now()-st);
    const body=await response.json();assert.equal(response.status,200);assert.equal(typeof body.text,"string");
    turn.transcript=body.text;turn.language=body.language;
    const normalized=body.text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu,"");
    turn.passed=item.expected.includes(normalized);
    // Semantic mismatches remain failures, but run each different planned case
    // exactly once. Transport/quota/auth failures stop; no retries/renewals.
  }
  report.after=await health();assert.equal(report.before.versionId,report.after.versionId);
  report.passed=report.turns.length===cases.length&&report.turns.every(turn=>turn.passed);
}catch{
  report.error="Short-speech acceptance stopped; inspect bounded status/transcript evidence and retained synthetic audio.";
}finally{
  if(cookie){try{const r=await request("/api/demo/session",{method:"DELETE"});report.sessionRevoked=r.ok;await r.arrayBuffer();}catch{report.sessionRevoked=false;}cookie="";}
  if(!report.sessionRevoked)report.passed=false;
  await writeFile(join(directory,"short-speech.json"),JSON.stringify(report,null,2),{flag:"wx",mode:0o600});
  console.log(JSON.stringify({directory,passed:report.passed,turns:report.turns,requests:report.requests,sessionRevoked:report.sessionRevoked}));
  if(!report.passed)process.exitCode=1;
}
