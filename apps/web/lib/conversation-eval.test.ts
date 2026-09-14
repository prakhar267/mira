import {afterEach,describe,expect,it,vi} from "vitest";
import {createServer,type IncomingMessage} from "node:http";
import {readFile} from "node:fs/promises";
// @ts-expect-error Independently executable Node evaluation helper is .mjs.
import {evaluationOptions,evaluateTurn,runConversationEvaluation,EVALUATION_POLICY_VERSION} from "../scripts/conversation-eval.mjs";

const token="S".repeat(43),cookie=`__Host-mira_demo=${token}`;
const cookieHeader=`${cookie}; Max-Age=3600; Path=/; HttpOnly; Secure; SameSite=Strict`;
const version="11111111-1111-4111-8111-111111111111",commit="a".repeat(40);
const env={COMPANARO_URL:"https://synthetic.example.test",MIRA_EVAL_ALLOW_PROVIDER_REQUESTS:"true",MIRA_EVAL_MAX_REQUESTS:"5",MIRA_EVAL_ADULT_DECLARED:"true",MIRA_EVAL_AI_PROCESSING_CONSENT:"true",MIRA_EVAL_POLICY_VERSION:"2026-09-13"};
const dataset=[{id:"synthetic-continuity",turns:[
  {text:"Synthetic cousin Arjun leaves Sunday.",language:"en",anchors:["Sunday"]},
  {text:"वो कब निकल रहा है?",language:"hi",anchors:["रविवार"]},
  {text:"ab Hinglish mein bolo, sawal mat poochna",language:"hinglish",noQuestion:true},
]}];
const replies=["Arjun leaves Sunday.","वो रविवार को निकल रहा है।","Haan, Arjun Sunday ko niklega."];
const sessionBody=()=>({mode:"demo",policyVersion:EVALUATION_POLICY_VERSION,expiresAt:new Date(Date.now()+3600000).toISOString()});
const noSleep=async()=>{};

function harness(overrides:{session?:()=>Response;reply?:(index:number)=>Response;health?:(index:number)=>Response;revoke?:()=>Response}={}){
  let chat=0,health=0;
  const bodies:{messages:{role:string;content:string}[];delivery:string}[]=[];
  const http=vi.fn(async(url:string,init:RequestInit)=>{
    expect(init.redirect).toBe("error");
    const path=new URL(url).pathname;
    if(path==="/api/health")return overrides.health?.(health++)??Response.json({versionId:version,commitSha:commit});
    if(path==="/api/demo/session"&&init.method==="POST"){
      expect(JSON.parse(String(init.body))).toEqual({adultDeclared:true,aiProcessingConsent:true,memoryConsent:false,policyVersion:"2026-09-13"});
      return overrides.session?.()??Response.json(sessionBody(),{status:201,headers:{"set-cookie":cookieHeader}});
    }
    if(path==="/api/demo/session"&&init.method==="DELETE")return overrides.revoke?.()??Response.json({revoked:true});
    if(path==="/api/companion-chat"){
      bodies.push(JSON.parse(String(init.body)));
      return overrides.reply?.(chat++)??Response.json({reply:replies[chat++],model:"@cf/meta/synthetic"});
    }
    throw Error("Unexpected synthetic request");
  });
  return {http,bodies,run:(settings:Record<string,string|undefined>={},data=dataset)=>runConversationEvaluation({...env,...settings},data,{fetchImpl:http,sleep:noSleep})};
}
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});

describe("consent-aware bounded conversation evaluator (synthetic only)",()=>{
  it("accepts actual generated demo/account cookies and detects current policy drift",async()=>{
    const {cloudStore}=await import("./cloud-store");
    const put=vi.spyOn(cloudStore,"put").mockResolvedValue(undefined);
    const {createDemoSession,INFERENCE_POLICY_VERSION}=await import("./inference-policy");
    const {createSession}=await import("./account-server");
    expect(EVALUATION_POLICY_VERSION).toBe(INFERENCE_POLICY_VERSION);
    const generated=await createDemoSession(false);
    const x=harness({session:()=>Response.json({mode:"demo",expiresAt:generated.session.expiresAt,policyVersion:generated.session.policyVersion},{status:201,headers:{"set-cookie":generated.cookie}})});
    expect(await x.run()).toMatchObject({success:true,sessionRevoked:true});
    const accountCookie=await createSession({id:"11111111-1111-4111-8111-111111111111",email:"synthetic@example.test",emailKey:"synthetic",name:"Synthetic QA",passwordHash:"synthetic-not-a-password",passwordSalt:"synthetic",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
    expect(evaluationOptions({...env,MIRA_EVAL_ACCOUNT_COOKIE:accountCookie.split(";")[0]}).accountCookie).toBe(accountCookie.split(";")[0]);
    expect(put).toHaveBeenCalledTimes(2); // Local mock storage; no account/provider I/O.
    const serialized=JSON.stringify(await harness().run({MIRA_EVAL_ACCOUNT_COOKIE:accountCookie.split(";")[0]}));
    expect(serialized).not.toContain(accountCookie.split(";")[0]!.split("=")[1]);
  });
  it.each([
    {COMPANARO_URL:undefined},{COMPANARO_URL:"http://public.example.test"},{COMPANARO_URL:"https://secret@example.test"},{COMPANARO_URL:"https://example.test/path"},{COMPANARO_URL:"https://example.test/?token=secret"},{COMPANARO_URL:"https://example.test/#private"},
    {MIRA_EVAL_ALLOW_PROVIDER_REQUESTS:undefined},{MIRA_EVAL_ALLOW_PROVIDER_REQUESTS:"false"},
    {MIRA_EVAL_MAX_REQUESTS:undefined},{MIRA_EVAL_MAX_REQUESTS:"0"},{MIRA_EVAL_MAX_REQUESTS:"101"},{MIRA_EVAL_MAX_REQUESTS:"1.5"},{MIRA_EVAL_MAX_REQUESTS:"Infinity"},
    {MIRA_EVAL_POLICY_VERSION:"legacy"},{MIRA_EVAL_ADULT_DECLARED:"false"},{MIRA_EVAL_AI_PROCESSING_CONSENT:undefined},
    {MIRA_EVAL_ACCOUNT_COOKIE:"other=secret"},{MIRA_EVAL_ACCOUNT_COOKIE:`__Host-companaro_session=${token}; other=secret`},
    {MIRA_EVAL_SCENARIOS:"missing-scenario"},{MIRA_EVAL_SCENARIOS:"synthetic-continuity,synthetic-continuity"},
  ])("rejects missing/invalid operator settings before any network %j",async(settings)=>{
    const x=harness();await expect(x.run(settings)).rejects.toThrow();expect(x.http).not.toHaveBeenCalled();
  });
  it("rejects malformed dataset before even checking health",async()=>{
    const x=harness();await expect(x.run({},[{id:"synthetic-continuity",turns:[]}])).rejects.toThrow("scenario");expect(x.http).not.toHaveBeenCalled();
  });
  it("issues one current-consent session, preserves multilingual context and revokes its cookie",async()=>{
    const x=harness(),report=await x.run();
    expect(report).toMatchObject({complete:true,success:true,total:3,passed:3,sessionRevoked:true,startingCommit:commit,endingVersion:version,upstreamProviderAttempts:null});
    expect(x.bodies.map(body=>body.delivery)).toEqual(["voice","video","voice"]);
    expect(x.bodies[2]!.messages).toEqual([{role:"user",content:dataset[0]!.turns[0]!.text},{role:"assistant",content:replies[0]},{role:"user",content:dataset[0]!.turns[1]!.text},{role:"assistant",content:replies[1]},{role:"user",content:dataset[0]!.turns[2]!.text}]);
    const posts=x.http.mock.calls.filter(([url,init])=>url.endsWith("/api/demo/session")&&init.method==="POST");expect(posts).toHaveLength(1);
    for(const [url,init] of x.http.mock.calls.filter(([url])=>url.endsWith("/api/companion-chat")))expect(new Headers(init.headers).get("cookie"),url).toBe(cookie);
    const last=x.http.mock.calls.at(-1)!;expect(last[1].method).toBe("DELETE");expect(new Headers(last[1].headers).get("cookie")).toBe(cookie);
    const output=JSON.stringify(report);expect(output).not.toContain(token);expect(output).not.toContain(dataset[0]!.turns[0]!.text);expect(output).not.toContain(replies[1]);
    expect(report.results[0].inputSha256).toMatch(/^[0-9a-f]{64}$/);expect(report.results[0].replySha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it("uses an explicitly supplied account session without creating, renewing or revoking it",async()=>{
    const x=harness(),account=`__Host-companaro_session=${token}`,report=await x.run({MIRA_EVAL_ACCOUNT_COOKIE:account});
    expect(report).toMatchObject({sessionMode:"account",success:true,sessionRevoked:null});
    expect(x.http.mock.calls.some(([url])=>url.includes("/api/demo/session"))).toBe(false);
    expect(x.http.mock.calls.every(([,init])=>new Headers(init.headers).get("cookie")===account)).toBe(true);
    expect(JSON.stringify(report)).not.toContain(token);
  });
  it("stops at a failed session before any provider request",async()=>{
    const x=harness({session:()=>Response.json({code:"POLICY_CONFIRMATION_REQUIRED",error:`raw secret ${token}`},{status:403})}),report=await x.run();
    expect(report).toMatchObject({success:false,complete:false,total:0,failureStage:"session",stopReason:"POLICY_CONFIRMATION_REQUIRED"});expect(x.bodies).toHaveLength(0);expect(JSON.stringify(report)).not.toContain(token);
  });
  it.each(["","other=secret",`${cookieHeader}; Domain=example.test`,cookie,`${cookie}; Path=/; Secure; SameSite=Strict`])("rejects unsafe/missing issued cookie %s",async(header)=>{
    const x=harness({session:()=>Response.json(sessionBody(),{status:201,headers:header?{"set-cookie":header}:{}})}),report=await x.run();
    expect(report.stopReason).toBe("SESSION_COOKIE_INVALID");expect(report.success).toBe(false);expect(x.bodies).toHaveLength(0);
  });
  it("revokes a valid issued cookie if session policy/expiry is invalid",async()=>{
    const x=harness({session:()=>Response.json({...sessionBody(),expiresAt:"2000-01-01T00:00:00Z"},{status:201,headers:{"set-cookie":cookieHeader}})}),report=await x.run();
    expect(report).toMatchObject({stopReason:"SESSION_POLICY_INVALID",sessionRevoked:true,total:0});
  });
  it("charges each dispatch, stops exactly at budget and never calls partial coverage success",async()=>{
    const x=harness(),report=await x.run({MIRA_EVAL_MAX_REQUESTS:"2"});
    expect(x.bodies).toHaveLength(2);expect(report).toMatchObject({total:2,passed:2,requestedTurns:3,stopReason:"REQUEST_BUDGET_EXHAUSTED",complete:false,success:false,sessionRevoked:true});
  });
  it.each([401,403,429,500,503])("does not retry/refund provider status %d or record an outage as success",async(status)=>{
    const x=harness({reply:()=>Response.json({code:status===429?"DAILY_CAPACITY_EXHAUSTED":token,error:token,reply:"A seemingly valid response."},{status})}),report=await x.run();
    expect(x.bodies).toHaveLength(1);expect(report).toMatchObject({total:1,passed:0,complete:false,success:false,sessionRevoked:true});
    expect(report.results[0].flags).toContain("service-error");expect(report.results[0].status).toBe(status);expect(JSON.stringify(report)).not.toContain(token);
  });
  it("counts a transport failure once without leaking its error or retrying",async()=>{
    const x=harness({reply:()=>{throw Error(`Network failed ${token}`);}}),report=await x.run();
    expect(report).toMatchObject({total:1,success:false,stopReason:"REQUEST_FAILED",sessionRevoked:true});expect(x.bodies).toHaveLength(1);expect(JSON.stringify(report)).not.toContain(token);
  });
  it("rejects empty successful provider payloads",async()=>{
    const x=harness({reply:()=>Response.json({reply:" "})}),report=await x.run();expect(report).toMatchObject({total:1,success:false,passed:0,stopReason:"INVALID_REPLY"});
  });
  it("rejects oversized and redirected responses without following them",async()=>{
    const huge=harness({reply:()=>new Response("x".repeat(33000))});expect((await huge.run()).stopReason).toBe("RESPONSE_TOO_LARGE");
    const moved=harness({reply:()=>Response.redirect("https://untrusted.example.test/",302)});expect((await moved.run()).stopReason).toBe("REDIRECT_REJECTED");expect(moved.bodies).toHaveLength(1);
  });
  it("bounds a stalled body even when cancellation never settles",async()=>{
    vi.useFakeTimers();let cancelled=0;
    const x=harness({reply:()=>new Response(new ReadableStream({pull:()=>new Promise(()=>{}),cancel:()=>{cancelled++;return new Promise(()=>{});}}))});
    const pending=x.run();await vi.advanceTimersByTimeAsync(15001);const report=await pending;
    expect(report).toMatchObject({stopReason:"REQUEST_TIMEOUT",total:1,sessionRevoked:true,success:false});expect(cancelled).toBeGreaterThan(0);expect(vi.getTimerCount()).toBe(0);
  });
  it("rejects release changes and unavailable revocation despite good language flags",async()=>{
    const changed=harness({health:index=>Response.json({versionId:version,commitSha:(index?"b":"a").repeat(40)})});expect(await changed.run()).toMatchObject({success:false,stableDeployment:false,stopReason:"DEPLOYMENT_CHANGED"});
    const revoke=harness({revoke:()=>Response.json({revoked:false},{status:503})});expect(await revoke.run()).toMatchObject({success:false,sessionRevoked:false,stopReason:"SESSION_REVOCATION_FAILED"});
  });
  it("retains original language, context-anchor, no-question and misunderstanding criteria",()=>{
    expect(evaluateTurn({language:"hi"},"आज अच्छा लगा।")).toEqual([]);
    expect(evaluateTurn({language:"hinglish"},"Haan, aaj accha laga.")).toEqual([]);
    expect(evaluateTurn({language:"en"},"I enjoyed that.")).toEqual([]);
    expect(evaluateTurn({language:"en"},"Haan, aaj accha laga.")).toContain("language");
    expect(evaluateTurn({language:"en",anchors:["Sunday"]},"Saturday works.")).toContain("context-anchor-review");
    expect(evaluateTurn({language:"en",noQuestion:true},"How did it go?")).toContain("unwanted-question");
    expect(evaluateTurn({language:"en"},"I caught that wrong.")).toContain("generic-misunderstanding");
  });
  it("keeps semantic flags failing even when every endpoint and release check succeeds",async()=>{
    const x=harness({reply:()=>Response.json({reply:"I caught that wrong. What happened?"})}),report=await x.run();
    expect(report).toMatchObject({complete:true,success:false,passed:0,total:3,genericMisunderstandingRate:1});
  });
  it("validates all current checked-in scenarios, including the full long-context sequence",async()=>{
    const source=JSON.parse(await readFile(new URL("../evals/conversations.json",import.meta.url),"utf8"));
    const x=harness(),report=await x.run({MIRA_EVAL_MAX_REQUESTS:"1",MIRA_EVAL_SCENARIOS:"long-conversation-24-turns"},source);
    expect(report.requestedTurns).toBe(24);expect(report.total).toBe(1);expect(report.complete).toBe(false);
    expect(evaluationOptions(env).base).toBe("https://synthetic.example.test");
  });
  it("carries the issued cookie and full context through an actual isolated HTTP server",async()=>{
    const requests:{path:string;method:string;cookie:string|undefined}[]=[],received:unknown[]=[];let chat=0;
    const server=createServer(async(request:IncomingMessage,response)=>{
      requests.push({path:request.url!,method:request.method!,cookie:request.headers.cookie});
      response.setHeader("Content-Type","application/json");
      const send=(value:unknown)=>response.end(JSON.stringify(value));
      if(request.url==="/api/health")return send({versionId:version,commitSha:commit});
      if(request.url==="/api/demo/session"&&request.method==="POST"){
        for await(const chunk of request)void chunk;
        response.statusCode=201;response.setHeader("Set-Cookie",cookieHeader);return send(sessionBody());
      }
      if(request.url==="/api/demo/session"&&request.method==="DELETE")return send({revoked:true});
      if(request.url==="/api/companion-chat"){
        let body="";for await(const chunk of request)body+=String(chunk);received.push(JSON.parse(body));return send({reply:replies[chat++]});
      }
      response.statusCode=404;send({code:"UNEXPECTED_TEST_ROUTE"});
    });
    await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
    try{
      const address=server.address();if(!address||typeof address==="string")throw Error("Synthetic server address missing");
      const origin=`http://127.0.0.1:${address.port}`;
      const localFetch=vi.fn((url:string,init:RequestInit)=>{expect(new URL(url).origin).toBe(origin);return fetch(url,init);});
      const report=await runConversationEvaluation({...env,COMPANARO_URL:origin},dataset,{fetchImpl:localFetch,sleep:noSleep});
      expect(report.success).toBe(true);expect(received).toHaveLength(3);
      expect(requests.filter(request=>request.path==="/api/companion-chat").every(request=>request.cookie===cookie)).toBe(true);
      expect(requests.at(-1)).toMatchObject({method:"DELETE",cookie});expect(JSON.stringify(report)).not.toContain(token);
    }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
});
