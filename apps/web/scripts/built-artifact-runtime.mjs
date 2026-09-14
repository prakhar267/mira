import {createRequire} from "node:module";
import {resolve,dirname,join,relative,isAbsolute} from "node:path";
import {pathToFileURL} from "node:url";
import {mkdir,writeFile,readdir,readFile,realpath,stat} from "node:fs/promises";
import {realpathSync} from "node:fs";
import {createServer} from "node:http";
import {Readable} from "node:stream";
import {pipeline} from "node:stream/promises";

const require=createRequire(import.meta.url);
const credentialNames=/(?:^|_)(?:KEY|TOKEN|SECRET|PASSWORD|AUTHORIZATION)(?:_|$)|^CLOUDFLARE_ACCOUNT_ID$/i;
const hopHeaders=new Set(["connection","keep-alive","proxy-connection","transfer-encoding","upgrade","trailer","te"]);

export function assertIsolatedEnvironment(environment){
  if(environment.CLOUDFLARE_API_TOKEN!=="mira-synthetic-only-no-cloud-access"||environment.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV!=="false"||environment.CI!=="true")throw Error("Credential-isolated process required");
  for(const [name,value] of Object.entries(environment))if(value&&credentialNames.test(name)&&name!=="CLOUDFLARE_API_TOKEN")throw Error("Inherited credentials are forbidden in artifact runtime");
}
function contained(root,path){const fragment=relative(root,path);return fragment!==".."&&!fragment.startsWith("../")&&!isAbsolute(fragment);}

export function validateCompiledConfig(config){
  if(config.no_bundle!==true||!config.main||!/\.(?:m?js)$/.test(config.main)||!config.name||!/^\d{4}-\d{2}-\d{2}$/.test(config.compatibility_date??""))throw Error("Expected an already-built ESM Worker config");
  if(config.rules?.some(rule=>rule.type!=="ESModule"))throw Error("Unsupported compiled module rule");
  if(config.define&&Object.keys(config.define).length)throw Error("Build-time definitions must already be compiled");
  if(config.services?.length||config.containers?.length||config.dispatch_namespaces?.length)throw Error("External workers are unsupported in isolated artifact tests");
  function rejectRemote(value){if(!value||typeof value!=="object")return;for(const [key,item] of Object.entries(value)){if(key==="remote"&&item===true||key==="remoteProxyConnectionString"&&item)throw Error("Remote bindings are forbidden in artifact runtime");rejectRemote(item);}}
  rejectRemote(config);
  for(const name of Object.keys(config.vars??{}))if(credentialNames.test(name))throw Error("Credentials must not be embedded in artifact vars");
  for(const binding of config.durable_objects?.bindings??[]){
    if(binding.script_name)throw Error("External Durable Objects are unsupported in artifact runtime");
    if(!config.migrations?.some(migration=>migration.new_sqlite_classes?.includes(binding.class_name)))throw Error("Expected SQLite Durable Object migration");
  }
}

export async function compiledModules(root,main){
  root=await realpath(root);main=await realpath(resolve(main)).catch(()=>resolve(main));
  if(!contained(root,main))throw Error("Worker entrypoint escapes built artifact");
  const paths=[];let files=0,bytes=0;
  async function visit(path,depth){
    if(depth>16)throw Error("Compiled artifact directory limit exceeded");
    for(const entry of await readdir(path,{withFileTypes:true})){
      if(++files>4096)throw Error("Compiled artifact file limit exceeded");
      const file=join(path,entry.name);
      if(entry.isSymbolicLink())throw Error("Compiled artifact must not contain symlinks");
      if(entry.isDirectory())await visit(file,depth+1);
      else if(/\.(?:m?js)$/.test(entry.name)){
        const size=(await stat(file)).size;bytes+=size;
        if(size>16*1024*1024||bytes>64*1024*1024)throw Error("Compiled artifact module byte limit exceeded");
        paths.push(file);
      }
    }
  }
  await visit(root,0);
  if(!paths.includes(main))throw Error("Worker entrypoint is missing from built modules");
  paths.sort((a,b)=>a===main?-1:b===main?1:a.localeCompare(b));
  return paths.map(path=>({type:"ESModule",path}));
}

// dispatchFetch returns decoded bodies. Preserve response streaming/cookies but
// do not send the compressed content length alongside a decoded stream.
export function createArtifactHttpServer(dispatchFetch,{onError=console.error}={}){
  const server=createServer(async(request,response)=>{
    const abort=new AbortController();
    const disconnected=()=>{if(!response.writableEnded)abort.abort(Error("Local client disconnected"));};
    request.once("aborted",disconnected);response.once("close",disconnected);
    try{
      const base=`http://127.0.0.1:${server.address().port}`;
      const url=new URL(request.url,base);
      if(url.origin!==base)throw Error("Non-local request target rejected");
      const connectionTokens=new Set((request.headers.connection??"").toLowerCase().split(",").map(value=>value.trim()));
      const headers=new Headers();
      for(let i=0;i<request.rawHeaders.length;i+=2){const name=request.rawHeaders[i];if(!hopHeaders.has(name.toLowerCase())&&!connectionTokens.has(name.toLowerCase()))headers.append(name,request.rawHeaders[i+1]);}
      const init={method:request.method,headers,signal:abort.signal,redirect:"manual"};
      if(request.method!=="GET"&&request.method!=="HEAD"){init.body=Readable.toWeb(request);init.duplex="half";}
      const upstream=await dispatchFetch(url.href,init);
      if(abort.signal.aborted){void upstream.body?.cancel().catch(()=>{});return;}
      response.statusCode=upstream.status;
      const decoded=upstream.headers.has("MF-Content-Encoding");
      for(const [name,value] of upstream.headers){if(!hopHeaders.has(name)&&name!=="set-cookie"&&name!=="mf-content-encoding"&&!(decoded&&name==="content-length"))response.setHeader(name,value);}
      const cookies=upstream.headers.getSetCookie();if(cookies.length)response.setHeader("set-cookie",cookies);
      if(request.method==="HEAD"||!upstream.body){void upstream.body?.cancel().catch(()=>{});response.end();}
      else await pipeline(Readable.fromWeb(upstream.body),response,{signal:abort.signal});
    }catch(error){
      if(!abort.signal.aborted){onError(error);if(!response.headersSent){response.statusCode=500;response.end("Isolated artifact request failed");}else response.destroy(error);}
    }finally{request.off("aborted",disconnected);response.off("close",disconnected);}
  });
  // Supported Node HTTP settings avoid the frontend's own 5-second boundary;
  // Miniflare dispatchFetch uses its supported pooled dispatcher internally.
  server.keepAliveTimeout=60000;server.keepAliveTimeoutBuffer=1000;
  server.headersTimeout=65000;server.requestTimeout=120000;
  return server;
}

// Local testing only. No application module is transformed or replaced. The
// SDK's direct workerd API avoids Wrangler Dev's additional HTTP ProxyWorker.
export async function startBuiltArtifactRuntime({artifact,directory,port}){
  artifact=resolve(artifact);directory=resolve(directory);
  if(!Number.isInteger(port)||port<1024||port>65535)throw Error("Invalid local runtime port");
  assertIsolatedEnvironment(process.env);
  await mkdir(directory,{recursive:true});
  const emptyEnv=join(directory,"empty.env");await writeFile(emptyEnv,"# No credentials\n");
  const {unstable_readConfig,unstable_getMiniflareWorkerOptions}=require("wrangler");
  const {Miniflare,convertV4MiniflareOptions,Response}=require(require.resolve("miniflare",{paths:[dirname(require.resolve("wrangler"))]}));
  const raw=JSON.parse(await readFile(artifact,"utf8"));validateCompiledConfig(raw);
  const config=unstable_readConfig({config:artifact});
  const artifactRoot=await realpath(dirname(artifact));
  if(!contained(artifactRoot,await realpath(config.main)))throw Error("Worker entrypoint escapes built artifact");
  if(config.assets?.directory){
    const assetDirectory=await realpath(resolve(artifactRoot,config.assets.directory));
    if(assetDirectory!==await realpath(join(artifactRoot,"../client")))throw Error("Assets must use the built sibling client directory");
    config.assets.directory=assetDirectory;
  }
  // The generated config remembers its original source path. Never let SDK
  // convenience loading discover that checkout's .dev.vars/.env files.
  config.userConfigPath=join(directory,"isolated.json");
  const {workerOptions,main,externalWorkers}=unstable_getMiniflareWorkerOptions(config,undefined,{envFiles:[emptyEnv],overrides:{enableContainers:false}});
  if(externalWorkers.length)throw Error("External workers are unsupported in isolated artifact tests");
  const {modulesRules,...sourceFreeOptions}=workerOptions;
  void modulesRules;
  const worker={...sourceFreeOptions,name:config.name,modules:await compiledModules(artifactRoot,main),modulesRoot:artifactRoot,
    bindings:{...workerOptions.bindings,MIRA_INFERENCE_DISABLED:"true"},
    unsafeRegisterWorker:false,
    outboundService:()=>new Response("External network disabled in isolated artifact runtime",{status:503})};
  for(const [name,value] of Object.entries(workerOptions.bindings??{}))if(JSON.stringify(value)!==JSON.stringify(config.vars[name]))throw Error("Unexpected non-artifact environment binding");
  for(const binding of config.durable_objects?.bindings??[])if(worker.durableObjects?.[binding.name]?.useSQLite!==true||worker.durableObjects[binding.name].className!==binding.class_name)throw Error("SQLite migration conversion mismatch");
  const options=convertV4MiniflareOptions({host:"127.0.0.1",port:0,cf:false,unsafeLocalExplorer:false,
    isolatedResourcePersistencePath:join(directory,"state"),resourceTmpPath:join(directory,"tmp"),
    unsafeDevRegistryPath:join(directory,"registry"),
    telemetry:{enabled:false},workers:[worker]});
  const runtime=new Miniflare(options);
  let httpServer;
  try{
    await runtime.ready;
    const base=`http://127.0.0.1:${port}`;
    const denied=await runtime.dispatchFetch(`${base}/api/companion-chat`,{method:"POST",headers:{origin:base,"content-type":"application/json"},body:"{}"});
    if(denied.status!==503||(await denied.json()).code!=="INFERENCE_DISABLED")throw Error("Artifact inference kill switch did not refuse provider work");
    httpServer=createArtifactHttpServer(runtime.dispatchFetch);
    await new Promise((resolve,reject)=>{httpServer.once("error",reject);httpServer.listen(port,"127.0.0.1",resolve);});
    console.log(`Ready on ${base}`);
    return {runtime,server:httpServer,dispose:async()=>{httpServer.closeAllConnections();await new Promise(resolve=>httpServer.close(resolve));await runtime.dispose();}};
  }catch(error){httpServer?.closeAllConnections();httpServer?.close();await runtime.dispose();throw error;}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href){
  const [artifact,directory,port]=process.argv.slice(2);
  const runtime=await startBuiltArtifactRuntime({artifact,directory,port:Number(port)});
  let stopping=false;
  const stop=async()=>{if(stopping)return;stopping=true;await runtime.dispose();};
  process.once("SIGTERM",stop);process.once("SIGINT",stop);
}
