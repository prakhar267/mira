import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { env } from "cloudflare:workers";
import { SELF } from "cloudflare:test";
import {cleanupWorkerState} from "./cleanup.mjs";

beforeEach(()=>{vi.stubGlobal("fetch",vi.fn(async()=>{throw new Error("External network forbidden in synthetic Worker tests");}));});
afterEach(async()=>{await cleanupWorkerState();vi.unstubAllGlobals();});
const post=(path,body)=>SELF.fetch(`http://localhost:4173${path}`,{method:"POST",headers:{origin:"http://localhost:4173","content-type":"application/json"},body:JSON.stringify(body)});
describe("active routes inside the Workers runtime",()=>{
  it("rejects unauthenticated provider calls before provider execution",async()=>{
    for(const path of ["/api/companion-chat","/api/companion-speech","/api/companion-transcribe","/api/companion-memory"]){
      const response=await post(path,{});expect([401,403]).toContain(response.status);
    }
  });
  it("runs actual SQLite transactions through the production Durable Object binding",async()=>{
    const stub=env.MIRA_STORE.get(env.MIRA_STORE.idFromName("isolated-storage-test"));
    const action=async data=>(await stub.fetch("https://store.internal/",{method:"POST",body:JSON.stringify(data)})).json();
    expect(await action({action:"put",key:"support:synthetic",value:"{}"})).toEqual({ok:true});
    expect(await action({action:"get",key:"support:synthetic"})).toEqual({value:"{}"});
    await action({action:"delete",key:"support:synthetic"});
    expect(await action({action:"get",key:"support:synthetic"})).toEqual({value:null});
  });
  it("reports missing mail configuration without claiming an email was sent",async()=>{
    const response=await post("/api/account/forgot-password",{email:"synthetic-adult@example.test"});
    expect(response.status).toBe(503);expect((await response.json()).error).toMatch(/not configured/i);
  });
});
