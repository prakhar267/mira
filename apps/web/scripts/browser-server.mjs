import {mkdtemp,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {spawn} from "node:child_process";

// Browser acceptance exercises compiled application bytes, not thousands of
// on-demand Vite modules. All inference/media/account fixtures are synthetic.
// --local alone does NOT disable remote AI. A server-side inference kill switch
// and synthetic HTTP fixtures prevent egress; no secret file is inherited.
const cwd=resolve(import.meta.dirname,"..");
const directory=await mkdtemp(join(tmpdir(),"mira-browser-runtime-"));
const envFile=join(directory,"empty.env");await writeFile(envFile,"# No credentials\n");
const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,
  ...(process.env.GITHUB_SHA?{GITHUB_SHA:process.env.GITHUB_SHA}:{}),
  XDG_CONFIG_HOME:join(directory,"config"),XDG_CACHE_HOME:join(directory,"cache"),
  // Explicit non-credential prevents Wrangler from using cached owner OAuth.
  CLOUDFLARE_API_TOKEN:"mira-synthetic-only-no-cloud-access",
  CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:"false",WRANGLER_SEND_METRICS:"false",CI:"true"};
const build=spawn("pnpm",["build:vinext"],{cwd,env,stdio:"inherit"});
const result=await new Promise((resolve,reject)=>{build.on("error",reject);build.on("exit",resolve);});
if(result!==0)throw new Error(`Browser artifact build failed (${result})`);
const server=spawn("pnpm",["exec","wrangler","dev","--config","dist/server/wrangler.json","--local","--no-bundle","--ip","127.0.0.1","--port","4397","--inspector-port","0","--persist-to",join(directory,"state"),"--env-file",envFile,"--var","MIRA_INFERENCE_DISABLED:true"],{cwd,env,stdio:"inherit",detached:process.platform!=="win32"});
const stop=()=>{if(server.pid)try{if(process.platform!=="win32")process.kill(-server.pid,"SIGTERM");else server.kill("SIGTERM");}catch{/* Already stopped. */}};
process.on("SIGINT",stop);process.on("SIGTERM",stop);
server.on("error",error=>{stop();throw error;});
server.on("exit",code=>{process.exitCode=code??0;});
