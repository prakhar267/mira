import {describe,expect,it} from "vitest";
import {readChatStream} from "./chat-stream";
function bytes(text:string){const data=new TextEncoder().encode(text);return new ReadableStream<Uint8Array>({start(c){for(let i=0;i<data.length;i+=3)c.enqueue(data.slice(i,i+3));c.close();}});}
describe("spoken inference streaming",()=>{
  it("decodes split UTF-8 Hindi and partial SSE frames",async()=>{const stream=bytes('data: {"response":"आज "}\r\n\r\ndata: {"response":"अच्छा दिन था।"}\n\ndata: [DONE]\n\n');expect(await readChatStream(stream,new AbortController().signal,true)).toBe("आज अच्छा दिन था।");});
  it("stops at two complete spoken sentences and cancels the source",async()=>{const content="Try a quiet park with Arjun. You can skip the crowded shopping streets.";const stream=bytes(`data: ${JSON.stringify({response:content})}\n\ndata: {"response":" This extra paragraph is not needed."}\n\n`);expect(await readChatStream(stream,new AbortController().signal,true)).toBe(content);});
  it("keeps the full reply for text and rejects provider error events",async()=>{expect(await readChatStream(bytes('data: {"response":"First part. Second part. Third part."}\n\n'),new AbortController().signal,false)).toBe("First part. Second part. Third part.");await expect(readChatStream(bytes('data: {"error":"quota"}\n\n'),new AbortController().signal,true)).rejects.toThrow("failed");});
  it("honors an aborted call",async()=>{const c=new AbortController();c.abort();await expect(readChatStream(bytes(""),c.signal,true)).rejects.toThrow();});
});
