import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,realpath} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import http from "node:http";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
// @ts-expect-error Independently executable local runtime helper is JavaScript.
import {assertIsolatedEnvironment,validateCompiledConfig,compiledModules,createArtifactHttpServer,startBuiltArtifactRuntime} from "../scripts/built-artifact-runtime.mjs";

let directory:string;
const disposers:Array<()=>Promise<void>>=[];
const isolated={CLOUDFLARE_API_TOKEN:"mira-synthetic-only-no-cloud-access",CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:"false",CI:"true"};
beforeEach(async()=>{directory=await realpath(await mkdtemp(join(tmpdir(),"mira-artifact-runtime-test-")));});
afterEach(async()=>{for(const dispose of disposers.splice(0).reverse())await dispose();vi.unstubAllEnvs();await rm(directory,{recursive:true,force:true});});
async function bridge(dispatch:unknown){
  const errors:unknown[]=[];
  const server=createArtifactHttpServer(dispatch,{onError:(error:unknown)=>errors.push(error)});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const port=(server.address() as {port:number}).port;
  disposers.push(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(resolve));});
  return{server,errors,base:`http://127.0.0.1:${port}`};
}

describe("exact built artifact boundaries",()=>{
  it("requires explicitly credential-isolated environment and rejects credential inheritance",()=>{
    expect(()=>assertIsolatedEnvironment(isolated)).not.toThrow();
    for(const env of [{...isolated,CLOUDFLARE_API_TOKEN:"real-token"},{...isolated,INWORLD_API_KEY:"must-not-use"},{...isolated,MIRA_ADMIN_KEY:"secret"},{...isolated,CI:"false"}]){
      expect(()=>assertIsolatedEnvironment(env)).toThrow();
    }
  });
  it("rejects noncompiled/remote/external/unmigrated configurations",()=>{
    const config={name:"fixture",main:"index.js",no_bundle:true,compatibility_date:"2026-09-02",rules:[{type:"ESModule"}],vars:{SITE_ORIGIN:"http://localhost"},durable_objects:{bindings:[{name:"STORE",class_name:"Store"}]},migrations:[{tag:"one",new_sqlite_classes:["Store"]}]};
    expect(()=>validateCompiledConfig(config)).not.toThrow();
    for(const changes of [{no_bundle:false},{main:"../../source.ts"},{rules:[{type:"CommonJS"}]},{define:{secret:"true"}},{vars:{INWORLD_API_KEY:"notallowed"}},{ai:{binding:"AI",remote:true}},{services:[{binding:"OTHER",service:"prod"}]},{migrations:[]}])expect(()=>validateCompiledConfig({...config,...changes})).toThrow();
  });
  it("enumerates exact entrypoint-first ESM files without reading source outside artifact",async()=>{
    await mkdir(join(directory,"nested"));
    const main=join(directory,"z-main.js"),other=join(directory,"nested","part.mjs");
    await writeFile(main,"import './nested/part.mjs';");await writeFile(other,"export default 42;");await writeFile(join(directory,"not-code.json"),"{}");
    const modules=await compiledModules(directory,main);
    expect(modules).toEqual([{type:"ESModule",path:main},{type:"ESModule",path:other}]);
    expect(await readFile(main,"utf8")).toBe("import './nested/part.mjs';");
    await expect(compiledModules(directory,join(directory,"missing.js"))).rejects.toThrow("missing");
    await expect(compiledModules(directory,join(directory,"../outside.js"))).rejects.toThrow("escapes");
  });
  it("refuses symlinked module escapes",async()=>{
    const main=join(directory,"main.js");await writeFile(main,"export default {}; ");
    await symlink(main,join(directory,"alias.js"));
    await expect(compiledModules(directory,main)).rejects.toThrow("symlinks");
  });
});

describe("streaming local HTTP adapter",()=>{
  it("emits the first response chunk before the producer completes",async()=>{
    let stream!:ReadableStreamDefaultController<Uint8Array>;
    const runtime=await bridge(async()=>new Response(new ReadableStream<Uint8Array>({start(controller){stream=controller;controller.enqueue(new TextEncoder().encode("first\n"));}}),{headers:{"content-type":"text/event-stream"}}));
    const response=await fetch(runtime.base),reader=response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("first\n");
    stream.enqueue(new TextEncoder().encode("last\n"));stream.close();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("last\n");expect((await reader.read()).done).toBe(true);
    expect(runtime.errors).toEqual([]);
  });
  it("streams request bodies without waiting for upload completion",async()=>{
    let first!:()=>void;const received=new Promise<void>(resolve=>{first=resolve;});
    const runtime=await bridge(async(url:string,init:RequestInit)=>{const req=new Request(url,init),reader=req.body!.getReader();expect(new TextDecoder().decode((await reader.read()).value)).toBe("first");first();expect(new TextDecoder().decode((await reader.read()).value)).toBe("last");expect((await reader.read()).done).toBe(true);return new Response("ok");});
    const request=http.request(runtime.base,{method:"POST"});
    const result=new Promise<string>((resolve,reject)=>{request.on("response",response=>{let text="";response.on("data",chunk=>{text+=chunk;});response.on("end",()=>resolve(text));});request.on("error",reject);});
    request.write("first");await received;request.end("last");expect(await result).toBe("ok");
  });
  it("preserves separate cookies and prevents stale compressed content lengths",async()=>{
    const headers=new Headers({"content-length":"3","MF-Content-Encoding":"gzip","content-type":"text/plain"});headers.append("set-cookie","first=1; HttpOnly; Path=/");headers.append("set-cookie","second=2; Path=/");
    const runtime=await bridge(async()=>new Response("decoded longer body",{headers}));
    const response=await fetch(runtime.base);
    expect(response.headers.getSetCookie()).toEqual(["first=1; HttpOnly; Path=/","second=2; Path=/"]);
    expect(response.headers.has("content-length")).toBe(false);expect(response.headers.has("mf-content-encoding")).toBe(false);expect(await response.text()).toBe("decoded longer body");
  });
  it("does not follow application redirects or emit a HEAD response body",async()=>{
    const runtime=await bridge(async(_url:string,init:RequestInit)=>{expect(init.redirect).toBe("manual");return new Response("not sent",{status:302,headers:{location:"/elsewhere"}});});
    const response=await fetch(runtime.base,{method:"HEAD",redirect:"manual"});
    expect(response.status).toBe(302);expect(response.headers.get("location")).toBe("/elsewhere");expect(await response.text()).toBe("");
  });
  it("propagates disconnect cancellation to both dispatch and stream producer",async()=>{
    let signal:AbortSignal|undefined,cancelled!:()=>void;const cancellation=new Promise<void>(resolve=>{cancelled=resolve;});
    const runtime=await bridge(async(_url:string,init:RequestInit)=>{signal=init.signal??undefined;return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode("start"));},cancel(){cancelled();}}));});
    const request=http.get(runtime.base);
    await new Promise<void>((resolve,reject)=>{request.on("response",response=>response.once("data",()=>{response.destroy();request.destroy();resolve();}));request.on("error",reject);});
    await cancellation;expect(signal?.aborted).toBe(true);expect(runtime.errors).toEqual([]);
  });
  it("bounds unread producer prefetch with backpressure",async()=>{
    let pulls=0;
    const runtime=await bridge(async()=>new Response(new ReadableStream({pull(controller){pulls++;controller.enqueue(new Uint8Array(64*1024));}})));
    const request=http.get(runtime.base);let response!:http.IncomingMessage;
    await new Promise<void>((resolve,reject)=>{request.on("response",value=>{response=value;response.pause();resolve();});request.on("error",reject);});
    await new Promise(resolve=>setTimeout(resolve,25));expect(pulls).toBeLessThan(256);
    response.destroy();request.destroy();
  });
});

describe("real isolated workerd artifact parity",()=>{
  it("preserves modules/assets/headers/SQLite/KV/version metadata, ignores source .dev.vars and denies outbound fetch",async()=>{
    for(const [name,value] of Object.entries(isolated))vi.stubEnv(name,value);
    vi.stubEnv("WRANGLER_SEND_METRICS","false");vi.stubEnv("WRANGLER_REGISTRY_PATH",join(directory,"registry"));vi.stubEnv("XDG_CONFIG_HOME",join(directory,"config"));
    const server=join(directory,"server"),client=join(directory,"client"),source=join(directory,"source");await Promise.all([mkdir(server),mkdir(client),mkdir(source)]);
    await writeFile(join(source,".dev.vars"),"INWORLD_API_KEY=must-not-be-loaded\nSITE_ORIGIN=https://wrong.invalid\n");
    await writeFile(join(server,"part.js"),"export const marker='exact-built-module';");
    await writeFile(join(server,"index.js"),`import {DurableObject} from 'cloudflare:workers';import {marker} from './part.js';
      export class Store extends DurableObject{async fetch(){this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS item(value INTEGER)');this.ctx.storage.sql.exec('INSERT INTO item VALUES(1)');return Response.json({count:[...this.ctx.storage.sql.exec('SELECT count(*) AS n FROM item')][0].n});}}
      export default {async fetch(request,env){let path=new URL(request.url).pathname;if(path==='/api/companion-chat')return Response.json({code:env.MIRA_INFERENCE_DISABLED==='true'?'INFERENCE_DISABLED':'BAD'},{status:503});if(path==='/sql')return env.STORE.get(env.STORE.idFromName('synthetic')).fetch('https://internal/');if(path==='/egress')return fetch('https://must-not-contact.invalid/');if(path==='/kv'){await env.KV.put('only-synthetic','value');return new Response(await env.KV.get('only-synthetic'));}return Response.json({marker,origin:env.SITE_ORIGIN,hasSecret:!!env.INWORLD_API_KEY,metadata:typeof env.VERSION.id,ai:!!env.AI});}};`);
    await writeFile(join(client,"hello.txt"),"exact-built-asset");await writeFile(join(client,"_headers"),"/hello.txt\n  X-Artifact-Parity: preserved\n");
    const config=join(server,"wrangler.json");await writeFile(config,JSON.stringify({name:"artifact-fixture",configPath:join(source,"wrangler.jsonc"),userConfigPath:join(source,"wrangler.jsonc"),main:"index.js",no_bundle:true,compatibility_date:"2026-09-02",compatibility_flags:["nodejs_compat"],rules:[{type:"ESModule",globs:["**/*.js"]}],vars:{SITE_ORIGIN:"http://synthetic.invalid"},assets:{directory:"../client",binding:"ASSETS"},durable_objects:{bindings:[{name:"STORE",class_name:"Store"}]},migrations:[{tag:"one",new_sqlite_classes:["Store"]}],kv_namespaces:[{binding:"KV",id:"synthetic"}],version_metadata:{binding:"VERSION"},ai:{binding:"AI"}}));
    const before=await readFile(config,"utf8");
    const reservation=http.createServer();await new Promise<void>(resolve=>reservation.listen(0,"127.0.0.1",resolve));const port=(reservation.address() as{port:number}).port;await new Promise<void>(resolve=>reservation.close(()=>resolve()));
    const running=await startBuiltArtifactRuntime({artifact:config,directory:join(directory,"runtime"),port});disposers.push(()=>running.dispose());const base=`http://127.0.0.1:${port}`;
    expect(await(await fetch(base)).json()).toMatchObject({marker:"exact-built-module",origin:"http://synthetic.invalid",hasSecret:false,metadata:"string",ai:true});
    const asset=await fetch(base+"/hello.txt");expect(asset.headers.get("x-artifact-parity")).toBe("preserved");expect(await asset.text()).toBe("exact-built-asset");
    expect(await(await fetch(base+"/sql")).json()).toEqual({count:1});expect(await(await fetch(base+"/sql")).json()).toEqual({count:2});
    expect(await(await fetch(base+"/kv")).text()).toBe("value");expect((await fetch(base+"/egress")).status).toBe(503);
    expect(await readFile(config,"utf8")).toBe(before);
  },20000);
});
