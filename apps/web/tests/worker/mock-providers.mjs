import { WorkerEntrypoint } from "cloudflare:workers";
// No real provider addresses or credentials are reachable through these classes.
export class MockAI extends WorkerEntrypoint {
  async run(model,input) {
    if(model.includes("bge-reranker"))return {response:[]};
    if(model.includes("whisper")) {
      const fixture = atob(input.audio ?? "").trim();
      if(fixture === "synthetic-stt-fallback-silence") return {text:"thanks for watching"};
      if(fixture === "synthetic-stt-fallback-short") return {text:"yes"};
      return {text:"Aaj chai peene ka mann hai.",language:"hi"};
    }
    const last=input.messages?.at(-1)?.content??"";
    const visible = text => model.includes("gemma-4") ? {choices:[{delta:{content:text}}]} : {response:text};
    if(input.stream&&input.messages?.some(message=>message.role==="user"&&message.content.includes("[synthetic-language-chain]"))) {
      // Follow only the application's final language setting. The production
      // route still performs its real consent, capacity and language checks.
      const language=last.match(/\[Application reply setting: ([^.]+)\./)?.[1];
      const reply=language==="Hindi in Devanagari"?"बारिश में चाय अच्छी लगती है।":language==="Hinglish in Roman letters"?"Baarish mein chai acchi lagti hai.":"Tea is nice when it rains.";
      return new Response(`data: ${JSON.stringify(visible(reply))}\n\ndata: [DONE]\n\n`).body;
    }
    if(input.stream&&last.includes("[synthetic-model-stop]")) {
      let cleanup;
      return new ReadableStream({start(controller){
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(visible("Sunday morning departure, got it."))}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n`));
        // No [DONE], and EOF would arrive well after the route's deadline.
        // Keep a real pending event so workerd doesn't classify the fixture
        // itself as hung. Successful model-stop consumption cancels the timer.
        cleanup=setTimeout(()=>controller.close(),15_000);
      },cancel(){clearTimeout(cleanup);}});
    }
    if(input.stream&&last.includes("[synthetic-stream-failure]"))return new Response(`data: ${JSON.stringify(visible("Let's practice your introduction. Start with your current role."))}\n\ndata: ${JSON.stringify({error:"Synthetic stream fixture failure"})}\n\n`,{headers:{"content-type":"text/event-stream"}}).body;
    const reply=/[\u0900-\u097f]/.test(last)?"हाँ, तुम्हारी बात समझ रही हूँ। आगे बताओ।":/\b(aaj|chai|kaise|tum|hai)\b/i.test(last)?"Haan, chai ka plan achha hai. Tum batao, kaisi chai pasand hai?":"That sounds good. Tell me a little more about it.";
    if(input.stream)return new Response(`data: ${JSON.stringify(visible(reply))}\n\ndata: [DONE]\n\n`,{headers:{"content-type":"text/event-stream"}}).body;
    return {response:reply};
  }
}
export class MockProviders extends WorkerEntrypoint {
  async fetch(request) {
    const path=new URL(request.url).pathname;
    if(path.includes("stt")||path.includes("transcri")) {
      const body = await request.json(), fixture = atob(body.audioData?.content ?? "").trim();
      if(fixture.startsWith("synthetic-stt-fallback-")) return new Response("Synthetic primary unavailable", {status:503});
      const transcript = fixture.startsWith("synthetic-stt-short:") ? fixture.slice("synthetic-stt-short:".length) : "Aaj chai peene ka mann hai.";
      return Response.json({transcription:{transcript}});
    }
    // Satisfies the adapter format boundary only; NOT playable/acoustic QA.
    if(path.endsWith("voice:stream"))return new Response(`${JSON.stringify({result:{audioContent:btoa("ID3synthetic-stream-not-acoustic-QA")}})}\n`,{headers:{"content-type":"application/x-ndjson"}});
    if(path.includes("tts")||path.includes("speech"))return Response.json({audioContent:btoa("ID3synthetic-audio-not-acoustic-QA")});
    return new Response("Synthetic provider has no such operation",{status:502});
  }
}
