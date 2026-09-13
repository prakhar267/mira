import { WorkerEntrypoint } from "cloudflare:workers";
// No real provider addresses or credentials are reachable through these classes.
export class MockAI extends WorkerEntrypoint {
  async run(model,input) {
    if(model.includes("bge-reranker"))return {response:[]};
    if(model.includes("whisper"))return {text:"Aaj chai peene ka mann hai.",language:"hi"};
    const last=input.messages?.at(-1)?.content??"";
    const reply=/[\u0900-\u097f]/.test(last)?"हाँ, तुम्हारी बात समझ रही हूँ। आगे बताओ।":/\b(aaj|chai|kaise|tum|hai)\b/i.test(last)?"Haan, chai ka plan achha hai. Tum batao, kaisi chai pasand hai?":"That sounds good. Tell me a little more about it.";
    if(input.stream)return new Response(`data: ${JSON.stringify({response:reply})}\n\ndata: [DONE]\n\n`,{headers:{"content-type":"text/event-stream"}}).body;
    return {response:reply};
  }
}
export class MockProviders extends WorkerEntrypoint {
  async fetch(request) {
    const path=new URL(request.url).pathname;
    if(path.includes("stt")||path.includes("transcri"))return Response.json({text:"Aaj chai peene ka mann hai.",transcription:"Aaj chai peene ka mann hai.",language:"hi"});
    // Satisfies the adapter format boundary only; NOT playable/acoustic QA.
    if(path.includes("tts")||path.includes("speech"))return Response.json({audioContent:btoa("ID3synthetic-audio-not-acoustic-QA")});
    return new Response("Synthetic provider has no such operation",{status:502});
  }
}
