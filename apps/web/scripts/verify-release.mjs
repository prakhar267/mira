import {spawn} from "node:child_process";
import {mkdir,writeFile} from "node:fs/promises";
const root=new URL("../../../",import.meta.url),directory=new URL(process.env.QA_DIRECTORY||"audit/2026-09-12-launch/",root);
await mkdir(directory,{recursive:true});const checks=[];
for(const task of ["lint","typecheck","test"]){const started=performance.now();let output="";const child=spawn("pnpm",[task],{cwd:root,stdio:["ignore","pipe","pipe"]});child.stdout.on("data",d=>output+=d);child.stderr.on("data",d=>output+=d);const status=await new Promise((resolve,reject)=>{child.on("error",reject);child.on("close",resolve);});await writeFile(new URL(`workspace-${task}.txt`,directory),output);checks.push({task,status,durationMs:Math.round(performance.now()-started)});console.log(`${task}: ${status===0?"PASS":"FAIL"}`);if(status!==0)break;}
await writeFile(new URL("workspace-checks.json",directory),JSON.stringify({at:new Date().toISOString(),checks},null,2));if(checks.some(c=>c.status!==0))process.exitCode=1;
