import {createHash} from "node:crypto";
import {readFile,writeFile,readdir,lstat} from "node:fs/promises";
import {resolve,join,relative,isAbsolute,dirname,sep} from "node:path";
import {fileURLToPath} from "node:url";
import {execFileSync} from "node:child_process";
import assert from "node:assert/strict";

const [mode,directory="apps/web/dist",expectedSha=process.env.GITHUB_SHA]=process.argv.slice(2);
const root=resolve(directory), manifestPath=join(root,"mira-release-manifest.json");
async function entries(path=root){
  const result=[];
  for(const name of (await readdir(path)).sort()){
    const target=join(path,name),info=await lstat(target);
    assert.ok(!info.isSymbolicLink(),"Release artifacts must not contain symlinks");
    if(info.isDirectory())result.push(...await entries(target));
    else {
      assert.ok(info.isFile(),"Release artifacts must contain only regular files");
      assert.ok(!/^(?:\.env(?:\..*)?|\.dev\.vars(?:\..*)?)$/.test(name),"Local credential files must not be included in release artifacts");
      if(target!==manifestPath)result.push({path:relative(root,target),sha256:createHash("sha256").update(await readFile(target)).digest("hex"),bytes:info.size});
    }
  }
  return result;
}
async function productionConfig(){
  assert.ok(!(await lstat(root)).isSymbolicLink(),"The release directory must not be a symlink");
  const config=JSON.parse(await readFile(join(root,"server/wrangler.json"),"utf8"));
  const source=JSON.parse(await readFile(join(dirname(fileURLToPath(import.meta.url)),"../wrangler.jsonc"),"utf8"));
  assert.equal(config.name,"luma-companion","Refuse to promote a non-production Worker name");
  assert.ok(!Object.keys(config.vars??{}).some(key=>key==="MIRA_LOCAL_TEST"||key.startsWith("MIRA_TEST_"))&&!config.services?.some(binding=>binding.binding==="AI"||String(binding.binding).startsWith("MIRA_TEST_")||/^Mock/.test(binding.entrypoint??"")),"Synthetic provider configuration cannot be promoted");
  assert.equal(config.ai?.binding,"AI","Production inference must use the Workers AI binding");
  const origin=new URL(config.vars?.SITE_ORIGIN??"http://invalid");
  assert.equal(origin.protocol,"https:","Production origin must use HTTPS");
  assert.ok(!["localhost","127.0.0.1","[::1]","invalid"].includes(origin.hostname)&&!origin.hostname.endsWith(".localhost"),"A local origin cannot be promoted");
  assert.equal(config.vars?.SITE_ORIGIN,source.vars.SITE_ORIGIN,"Deployment origin differs from reviewed production source configuration");
  assert.deepEqual(config.durable_objects?.bindings,source.durable_objects.bindings,"Preserve the authoritative and recovery storage bindings");
  assert.deepEqual(config.migrations,source.migrations,"Preserve the reviewed Durable Object migration history");
  assert.deepEqual(config.kv_namespaces,source.kv_namespaces,"Preserve legacy deletion/migration storage bindings");
  assert.equal(config.vars?.BILLING_ENABLED,"false","This release excludes payment activation");
  for(const [name,value,kind] of [["entrypoint",config.main,"file"],["assets",config.assets?.directory,"directory"]]){
    assert.ok(typeof value==="string"&&!isAbsolute(value),`Release ${name} must be relative to the sealed artifact`);
    const target=resolve(root,"server",value),contained=relative(root,target);
    assert.ok(contained&&!contained.startsWith(`..${sep}`)&&contained!==".."&&!isAbsolute(contained),`Release ${name} escapes the sealed artifact`);
    const info=await lstat(target);
    assert.ok(kind==="file"?info.isFile():info.isDirectory(),`Release ${name} is missing or has the wrong type`);
  }
}
await productionConfig();
if(mode==="create"){
  const head=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
  const sha=expectedSha??head;
  assert.match(sha,/^[a-f0-9]{40}$/);
  assert.equal(sha,head,"Release identity must match the checked-out source commit");
  // Only the timestamped audit report is expected untracked output. An
  // untracked module can still be bundled, so ignoring all untracked files
  // would falsely label an artifact as coming solely from committed source.
  const status=execFileSync("git",["status","--porcelain","--untracked-files=all"],{encoding:"utf8"}).trimEnd();
  const dirty=status.split("\n").some(line=>line&&!/^\?\? audit\/readiness-[A-Za-z0-9_-]+\/(?:dependency-audit\.json|artifact\/production-smoke\.json)$/.test(line));
  if(process.env.CI)assert.equal(dirty,false,"CI release artifact must be built from clean committed source");
  const files=await entries();assert.ok(files.length>5,"Build the full Worker artifact first");
  const manifest={schemaVersion:1,sha,dirty,node:process.version,createdAt:new Date().toISOString(),files};
  await writeFile(manifestPath,JSON.stringify(manifest,null,2));
  console.log(JSON.stringify({created:true,sha,dirty,files:files.length,bytes:files.reduce((sum,file)=>sum+file.bytes,0)}));
}else if(mode==="verify"){
  const manifest=JSON.parse(await readFile(manifestPath,"utf8"));
  assert.match(expectedSha??"",/^[a-f0-9]{40}$/,"Expected release commit is required");
  assert.equal(manifest.sha,expectedSha);assert.equal(manifest.schemaVersion,1);assert.equal(manifest.dirty,false,"Uncommitted artifacts cannot be promoted");
  assert.ok(Array.isArray(manifest.files)&&manifest.files.length>5,"Release manifest must include the complete Worker artifact");
  assert.deepEqual(await entries(),manifest.files,"Release artifact changed after testing");
  console.log(JSON.stringify({verified:true,sha:manifest.sha,files:manifest.files.length}));
}else throw new Error("Use create or verify, an artifact directory and expected commit SHA");
