import {createRequire} from "node:module";
import {spawnSync} from "node:child_process";
import {readFile,mkdir,writeFile} from "node:fs/promises";
import assert from "node:assert/strict";
import {reviewedParserException,parserExceptions} from "../lib/dependency-policy.ts";
const root=new URL("../../../",import.meta.url);
const mobile=createRequire(new URL("apps/mobile/package.json",root));
const native=createRequire(mobile.resolve("react-native/package.json"));
const cli=createRequire(native.resolve("@react-native/community-cli-plugin/package.json"));
const metro=createRequire(cli.resolve("metro/package.json"));
const imageEntry=metro.resolve("image-size");
if(process.argv.includes("--image-worker")) {
  const require=createRequire(imageEntry),size=require(imageEntry);
  const icns=Buffer.alloc(16);icns.write("icns");icns.writeUInt32BE(16,4);icns.write("icp4",8);
  assert.throws(()=>size(icns),/Invalid ICNS/);
  icns.writeUInt32BE(8,12);assert.equal(size(icns).width,16);
  const {findBox}=require("./types/utils.js");
  for(const name of ["meta","jxlp","jxlc"]) {const bad=Buffer.alloc(8);bad.write(name,4);assert.throws(()=>findBox(bad,name,0),/Invalid image container/);}
  const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB1sAAAAASUVORK5CYII=","base64");assert.equal(size(png).width,1);
  console.log("Malformed ICNS/HEIF/JXL size guards and valid ICNS/PNG: PASS");
} else {
  const child=spawnSync(process.execPath,[new URL(import.meta.url).pathname,"--image-worker"],{encoding:"utf8",timeout:3000});
  assert.equal(child.status,0,child.stderr||child.error?.message);
  const audit=spawnSync("pnpm",["audit","--prod","--json"],{cwd:root,encoding:"utf8",timeout:30000});
  if(audit.error)throw audit.error;
  const body=JSON.parse(audit.stdout);
  assert.ok(body.advisories && body.metadata?.vulnerabilities,"Audit did not return a recognized complete result");
  const findings=Object.values(body.advisories).map(a=>({name:a.module_name,severity:a.severity,url:a.url,findings:a.findings,reviewedException:reviewedParserException(a)}));
  const patch=await readFile(new URL("patches/image-size@1.2.1.patch",root),"utf8");
  assert.match(patch,/Invalid ICNS entry length/);assert.match(patch,/Invalid image container box size/);
  const report={at:new Date().toISOString(),node:process.version,parserRegression:child.stdout.trim(),findings,exceptions:parserExceptions,note:"A committed local patch mitigates these exact non-serving mobile-tooling parser paths. Exceptions expire on 27 September 2026 and fail for any new advisory/version/path. This is not independent security approval."};
  const dir=new URL(`audit/readiness-${report.at.replace(/[:.]/g,"-")}/`,root);await mkdir(dir,{recursive:true});await writeFile(new URL("dependency-audit.json",dir),JSON.stringify(report,null,2),{flag:"wx"});console.log(JSON.stringify({...report,findings:findings.map(f=>({...f,findings:f.findings.map(p=>({version:p.version,pathCount:p.paths.length}))})),reportPath:dir.pathname},null,2));
  if(findings.some(f=>!f.reviewedException))process.exitCode=1;
}
