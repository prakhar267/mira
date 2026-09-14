import {describe,expect,it,vi} from "vitest";
import {AccountError,accountErrorResponse,parseJsonObject} from "./account-server";

describe("account streamed request boundaries",()=>{
  it("rejects absent-length streamed bodies before reading the rest",async()=>{
    const cancel=vi.fn();let delivered=0;
    const stream=new ReadableStream<Uint8Array>({pull(controller){delivered++;controller.enqueue(new Uint8Array(1024));},cancel});
    const request=new Request("https://synthetic.test/api/account/state",{method:"PUT",body:stream,duplex:"half"} as RequestInit);
    await expect(parseJsonObject(request,1500)).rejects.toMatchObject({status:413,code:"PAYLOAD_TOO_LARGE"});expect(cancel).toHaveBeenCalledOnce();expect(delivered).toBeLessThanOrEqual(3);
  });
  it("does not trust a misleading Content-Length",async()=>{
    const request=new Request("https://synthetic.test",{method:"POST",headers:{"content-length":"1"},body:JSON.stringify({payload:"x".repeat(100)})});
    await expect(parseJsonObject(request,30)).rejects.toMatchObject({status:413});
  });
  it("returns stable codes and content-free request IDs without raw exception text",async()=>{
    const conflict=accountErrorResponse(new AccountError("Reload your account.",409,"STATE_CONFLICT",7));expect(await conflict.json()).toMatchObject({code:"STATE_CONFLICT",revision:7,requestId:expect.any(String)});
    const failed=accountErrorResponse(new Error("Synthetic private provider token"));expect(await failed.text()).not.toContain("private provider token");
  });
});
