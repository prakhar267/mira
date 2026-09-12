import {mkdir,writeFile,readFile} from "node:fs/promises";
import {spawnSync} from "node:child_process";
const base=(process.env.COMPANARO_URL||"https://luma-companion.prakhargupta267.workers.dev").replace(/\/$/,"");
const directory=new URL(process.env.QA_DIRECTORY||"audit/2026-09-12-launch/",new URL("../../../",import.meta.url));
const out=new URL("audio/",directory);await mkdir(out,{recursive:true});
const cases=[{id:"english",text:"My brother Kabir has an interview tomorrow and he is feeling nervous.",anchors:["interview","kabir","brother"]},{id:"hindi",text:"आज मेरा दिन अच्छा था। मेरी दोस्त नेहा कल पुणे आ रही है।",anchors:["नेहा","पुणे","दोस्त"]},{id:"hinglish",text:"Yaar aaj office mein kaafi stress tha. Boss ne meeting mein daant diya.",anchors:["office","boss","meeting","बॉस","मीटिंग"]}];
const results=[];
async function post(path,body){return fetch(base+path,{method:"POST",headers:{"content-type":"application/json",origin:base},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});}
for(const item of cases){
  const start=performance.now(),speech=await post("/api/companion-speech",{text:item.text});
  if(!speech.ok){results.push({id:item.id,error:`TTS ${speech.status}`});continue;}
  const bytes=Buffer.from(await speech.arrayBuffer());const ttsMs=Math.round(performance.now()-start);
  const path=new URL(`${item.id}.mp3`,out);await writeFile(path,bytes);
  const noisy=new URL(`${item.id}-noise.wav`,out);
  const made=spawnSync("ffmpeg",["-hide_banner","-loglevel","error","-y","-i",path.pathname,"-f","lavfi","-i","anoisesrc=color=pink:amplitude=0.012","-filter_complex","[0:a][1:a]amix=inputs=2:duration=first:normalize=0[a]","-map","[a]","-ar","24000","-ac","1",noisy.pathname]);
  for(const variant of ["clean",...(made.status===0?["noise"]:[])]){
    const audio=variant==="clean"?bytes:await readFile(noisy);
    const st=performance.now(),response=await post("/api/companion-transcribe",{audioBase64:audio.toString("base64"),contentType:variant==="clean"?"audio/mpeg":"audio/wav"});const data=await response.json();const sttMs=Math.round(performance.now()-st);
    const text=data.text??"";const anchorHits=item.anchors.filter(a=>text.toLowerCase().includes(a.toLowerCase()));
    results.push({id:item.id,variant,reference:item.text,transcript:text,detectedLanguage:data.language,status:response.status,ttsMs,sttMs,anchorHits,passed:response.ok&&anchorHits.length>=1,error:data.error});
    console.log(`${item.id}/${variant}: ${response.status} STT ${sttMs}ms, TTS ${ttsMs}ms; ${text}`);
  }
}
const report={at:new Date().toISOString(),base,method:"Synthetic Priya-generated clips through live TTS/STT APIs, plus pink-noise overlays. Not a physical microphone, accent diversity or human listening test.",results};await writeFile(new URL("../speech-roundtrip.json",out),JSON.stringify(report,null,2));if(results.some(r=>!r.passed))process.exitCode=1;
