import {describe,expect,it} from "vitest";
import {readChatStream} from "./chat-stream";
function bytes(text:string){const data=new TextEncoder().encode(text);return new ReadableStream<Uint8Array>({start(c){for(let i=0;i<data.length;i+=3)c.enqueue(data.slice(i,i+3));c.close();}});}
describe("spoken inference streaming",()=>{
  it.each(["You're welcome!", "Koi baat nahi.", "कोई बात नहीं।"])("finishes an explicitly one-sentence call turn without waiting for more tokens: %s",reply=>{
    let canceled=false;
    const stream=new ReadableStream<Uint8Array>({start(c){c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({response:reply})}\n\n`));},cancel(){canceled=true;return new Promise(()=>{});}});
    return readChatStream(stream,AbortSignal.timeout(300),true,undefined,1).then(result=>{expect(result).toBe(reply);expect(canceled).toBe(true);});
  });
  it("keeps general call answers and typed messages complete",async()=>{
    const full="You're welcome! Here's the next practice question.";
    const s=()=>bytes(`data: ${JSON.stringify({response:full})}\n\ndata: [DONE]\n\n`);
    expect(await readChatStream(s(),new AbortController().signal,true)).toBe(full);
    expect(await readChatStream(s(),new AbortController().signal,false,undefined,1)).toBe(full);
  });
  it("does not early-cut a quoted or unfinished acknowledgement",async()=>{
    expect(await readChatStream(bytes('data: {"response":"\\\"Koi baat nahi."}\n\ndata: {"response":"\\\""}\n\ndata: [DONE]\n\n'),new AbortController().signal,true,undefined,1)).toBe('"Koi baat nahi."');
    expect(await readChatStream(bytes('data: {"response":"You are"}\n\ndata: {"response":" welcome!"}\n\ndata: [DONE]\n\n'),new AbortController().signal,true,undefined,1)).toBe('You are welcome!');
  });
  it("reads visible OpenAI-shaped deltas without exposing reasoning or tools",async()=>{
    const frames=[{choices:[{delta:{role:"assistant",reasoning_content:"private reasoning"}}]},{choices:[{delta:{content:"Kal ke liye "}}]},{choices:[{delta:{content:"all the best!"}}]}];
    const received:string[]=[];
    expect(await readChatStream(bytes(frames.map(frame=>`data: ${JSON.stringify(frame)}\n\n`).join("")+"data: [DONE]\n\n"),new AbortController().signal,false,async text=>{received.push(text);})).toBe("Kal ke liye all the best!");
    expect(received.join("")).not.toContain("reasoning");
  });
  it("waits for split closing quotes instead of cutting a message draft",async()=>{
    const draft='"All the best for your first day at work. I hope it goes really well!"';
    const stream=bytes(`data: ${JSON.stringify({response:draft.slice(0,-1)})}\n\ndata: ${JSON.stringify({response:'"'})}\n\ndata: [DONE]\n\n`);
    expect(await readChatStream(stream,new AbortController().signal,true)).toBe(draft);
  });
  it("decodes split UTF-8 Hindi and partial SSE frames",async()=>{const stream=bytes('data: {"response":"आज "}\r\n\r\ndata: {"response":"अच्छा दिन था।"}\n\ndata: [DONE]\n\n');expect(await readChatStream(stream,new AbortController().signal,true)).toBe("आज अच्छा दिन था।");});
  it("stops at two complete spoken sentences and cancels the source",async()=>{const content="Try a quiet park with Arjun. You can skip the crowded shopping streets.";const stream=bytes(`data: ${JSON.stringify({response:content})}\n\ndata: {"response":" This extra paragraph is not needed."}\n\n`);expect(await readChatStream(stream,new AbortController().signal,true)).toBe(content);});
  it("keeps the full reply for text and rejects provider error events",async()=>{expect(await readChatStream(bytes('data: {"response":"First part. Second part. Third part."}\n\n'),new AbortController().signal,false)).toBe("First part. Second part. Third part.");await expect(readChatStream(bytes('data: {"error":"quota"}\n\n'),new AbortController().signal,true)).rejects.toThrow("failed");});
  it("honors an aborted call",async()=>{const c=new AbortController();c.abort();await expect(readChatStream(bytes(""),c.signal,true)).rejects.toThrow();});
  it("bounds unterminated frames and total ignored transport bytes",async()=>{
    const frames=(text:string)=>new ReadableStream<Uint8Array>({start(c){const input=new TextEncoder().encode(text);for(let i=0;i<input.length;i+=8000)c.enqueue(input.slice(i,i+8000));c.close();}});
    await expect(readChatStream(frames(`data: ${"x".repeat(64_001)}`),new AbortController().signal,false)).rejects.toThrow("frame exceeded");
    await expect(readChatStream(frames(": keepalive\n".repeat(47_000)),new AbortController().signal,false)).rejects.toThrow("transport limit");
  });
  it("returns on DONE without waiting for the connection or cancellation acknowledgement",async()=>{
    let canceled=false;
    const stream=new ReadableStream<Uint8Array>({start(c){c.enqueue(new TextEncoder().encode('data: {"response":"Sunday morning, got it."}\n\ndata: [DONE]\n\n'));},cancel(){canceled=true;return new Promise(()=>{});}});
    expect(await readChatStream(stream,new AbortController().signal,true)).toBe("Sunday morning, got it.");
    expect(canceled).toBe(true);
  });
  it("does not wait for cancellation after two complete sentences",async()=>{
    const reply="A monotonous day can really drag. Kal thoda routine badal lete hain.";
    const stream=new ReadableStream<Uint8Array>({start(c){c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({response:reply})}\n\n`));},cancel(){return new Promise(()=>{});}});
    expect(await readChatStream(stream,new AbortController().signal,true)).toBe(reply);
  });
  it("finishes a single sentence on the model stop frame even if SSE stays open",async()=>{
    let canceled=false;
    const stream=new ReadableStream<Uint8Array>({start(c){
      c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"तुम अपना कैमरा भूल गए थे।"}}]}\n\n'));
      c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'));
    },cancel(){canceled=true;return new Promise(()=>{});}});
    expect(await readChatStream(stream,AbortSignal.timeout(500),true)).toBe("तुम अपना कैमरा भूल गए थे।");
    expect(canceled).toBe(true);
  });
  it("does not treat length/tool-call markers as a successful model stop",async()=>{
    for(const reason of ["length","tool_calls"]){
      const stream=new ReadableStream<Uint8Array>({start(c){c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({choices:[{delta:{content:"An incomplete"},finish_reason:reason}]})}\n\n`));}});
      await expect(readChatStream(stream,AbortSignal.timeout(25),true)).rejects.toThrow();
    }
  });
});
