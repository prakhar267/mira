import {afterEach,describe,expect,it,vi} from "vitest";
import {discardUnusedRequestBody,withRequestBodyCleanup} from "./unused-request-body";

const request=(body:BodyInit)=>new Request("https://mira.test/api/reject",{method:"POST",body,duplex:"half"} as RequestInit);
afterEach(()=>vi.useRealTimers());
describe("bounded unread request cleanup",()=>{
  it("drains rejected JSON without changing the response or calling more work",async()=>{
    const input=request('{"synthetic":true}'), response=Response.json({code:"INFERENCE_DISABLED"},{status:503});
    const handler=vi.fn(()=>response);
    expect(await withRequestBodyCleanup(handler)(input)).toBe(response);
    expect(input.bodyUsed).toBe(true);expect(input.body?.locked).toBe(false);expect(handler).toHaveBeenCalledTimes(1);
  });
  it("preserves a thrown handler error",async()=>{
    const cause=new Error("synthetic auth failure"),input=request("{}");
    await expect(withRequestBodyCleanup(()=>{throw cause;})(input)).rejects.toBe(cause);
    expect(input.bodyUsed).toBe(true);
  });
  it("does not touch absent, consumed or handler-owned locked bodies",async()=>{
    await discardUnusedRequestBody(new Request("https://mira.test/"));
    const consumed=request("read already");await consumed.text();await discardUnusedRequestBody(consumed);
    const locked=request("owned"),reader=locked.body!.getReader();await discardUnusedRequestBody(locked);
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("owned");reader.releaseLock();
  });
  it("bounds an endless stream by bytes and cancels without buffering it",async()=>{
    const cancel=vi.fn();let reads=0;
    const input=request(new ReadableStream({pull(c){reads++;c.enqueue(new Uint8Array(8192));},cancel},{highWaterMark:0}));
    await discardUnusedRequestBody(input);
    expect(reads).toBe(8);expect(cancel).toHaveBeenCalledOnce();expect(input.body?.locked).toBe(false);
  });
  it("bounds endless empty chunks",async()=>{
    let reads=0;const cancel=vi.fn();
    await discardUnusedRequestBody(request(new ReadableStream({pull(c){reads++;c.enqueue(new Uint8Array());},cancel},{highWaterMark:0})));
    expect(reads).toBe(32);expect(cancel).toHaveBeenCalledOnce();
  });
  it("does not wait for a stalled body or hanging cancel operation",async()=>{
    vi.useFakeTimers();const cancel=vi.fn(()=>new Promise<void>(()=>{}));
    const input=request(new ReadableStream({pull(){return new Promise(()=>{});},cancel}));
    const pending=discardUnusedRequestBody(input);await vi.advanceTimersByTimeAsync(100);await pending;
    expect(cancel).toHaveBeenCalledOnce();expect(input.body?.locked).toBe(false);expect(vi.getTimerCount()).toBe(0);
  });
  it("does not replace the response when reading the body fails",async()=>{
    const input=request(new ReadableStream({pull(c){c.error(new Error("synthetic disconnect"));}})),response=new Response("denied",{status:403});
    expect(await withRequestBodyCleanup(()=>response)(input)).toBe(response);
  });
});
