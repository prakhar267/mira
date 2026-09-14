import {describe,expect,it} from "vitest";
// @ts-expect-error Independently executable Node release helper is .mjs.
import {verifyRuntimeCadence} from "../scripts/runtime-cadence.mjs";

const sha="a".repeat(64),url="http://127.0.0.1:4398/compiled.js";
describe("compiled runtime send-time regression",()=>{
  it("holds send cadence instead of adding response latency to each interval",async()=>{
    let time=0;const sleeps:number[]=[],sends:number[]=[];
    const results=await verifyRuntimeCadence({url,expectedSha256:sha,count:4,now:()=>time,
      sleep:async(ms:number)=>{sleeps.push(ms);time+=ms;},
      request:async()=>{sends.push(time);time+=137;return{status:200,sha256:sha};}});
    expect(sends).toEqual([0,5000,10000,15000]);expect(sleeps).toEqual([0,4863,4863,4863]);expect(results).toHaveLength(4);
  });
  it.each([{status:500,sha256:sha},{status:200,sha256:"b".repeat(64)}])("fails immediately for a response or byte mismatch: %j",async(response)=>{
    let calls=0;
    await expect(verifyRuntimeCadence({url,expectedSha256:sha,sleep:async()=>{},request:async()=>{calls++;return response;}})).rejects.toThrow("failed at request 1");
    expect(calls).toBe(1);
  });
  it("does not retry network errors",async()=>{
    let calls=0;
    await expect(verifyRuntimeCadence({url,expectedSha256:sha,sleep:async()=>{},request:async()=>{calls++;throw new Error("connection lost");}})).rejects.toThrow("connection lost");
    expect(calls).toBe(1);
  });
  it.each(["https://127.0.0.1/asset","http://example.com/asset","http://secret@127.0.0.1/asset"])("rejects a non-isolated endpoint %s",async(target)=>{
    await expect(verifyRuntimeCadence({url:target,expectedSha256:sha})).rejects.toThrow("isolated loopback");
  });
  it.each([{count:1},{count:21},{intervalMs:0},{intervalMs:5001},{expectedSha256:"invalid"}])("rejects invalid bounds %j",async(overrides)=>{
    await expect(verifyRuntimeCadence({url,expectedSha256:sha,...overrides})).rejects.toThrow("Invalid bounded");
  });
});
