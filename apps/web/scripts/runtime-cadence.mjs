import http from "node:http";
import {createHash} from "node:crypto";

// Wrangler's dev proxy can fail on a five-second SEND cadence. Sleeping after
// each response misses that race. This release check keeps the original clock,
// uses fresh client sockets, and stops at the first error: it never retries.
export async function verifyRuntimeCadence({url,expectedSha256,count=6,intervalMs=5000,
  now=()=>performance.now(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
  request=readStaticAsset,onResult=()=>{}}){
  const target=new URL(url);
  if(target.protocol!=="http:"||target.hostname!=="127.0.0.1"||target.username||target.password)throw new Error("Cadence check requires an isolated loopback runtime");
  if(!/^[a-f0-9]{64}$/.test(expectedSha256)||!Number.isInteger(count)||count<2||count>20||!Number.isInteger(intervalMs)||intervalMs<1||intervalMs>5000)throw new Error("Invalid bounded cadence check");
  const started=now(),results=[];
  for(let index=0;index<count;index++){
    await sleep(Math.max(0,started+index*intervalMs-now()));
    const sentMs=now()-started;
    const response=await request(target);
    const result={index,sentMs,...response};results.push(result);onResult(result);
    if(response.status!==200||response.sha256!==expectedSha256)throw new Error(`Static runtime cadence failed at request ${index+1}: HTTP ${response.status}; built-byte hash match=${response.sha256===expectedSha256}`);
  }
  return results;
}

function readStaticAsset(url){
  return new Promise((resolve,reject)=>{
    const started=performance.now(),hash=createHash("sha256");let bytes=0;
    const request=http.get(url,{agent:false,headers:{connection:"close"}},response=>{
      response.on("data",chunk=>{
        bytes+=chunk.length;
        if(bytes>4*1024*1024){response.destroy(new Error("Cadence asset exceeded size limit"));return;}
        hash.update(chunk);
      });
      response.on("error",reject);
      response.on("end",()=>resolve({status:response.statusCode,sha256:hash.digest("hex"),bytes,elapsedMs:performance.now()-started}));
    });
    const deadline=setTimeout(()=>request.destroy(new Error("Cadence request timed out")),4000);
    request.on("error",reject);request.on("close",()=>clearTimeout(deadline));
  });
}
