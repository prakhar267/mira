import {spawnSync} from "node:child_process";
import {mkdir,writeFile} from "node:fs/promises";
import assert from "node:assert/strict";

// Operator-only. The recovery target is a separate synthetic Durable Object,
// never the account store. Credentials are kept in memory and omitted from evidence.
const base=(process.env.COMPANARO_URL||"https://luma-companion.prakhargupta267.workers.dev").replace(/\/$/,"");
const key=process.env.MIRA_ADMIN_KEY || (process.platform==="darwin"?spawnSync("security",["find-generic-password","-a","prakhar","-s","Mira production operator","-w"],{encoding:"utf8"}).stdout.trim():"");
assert.ok(key,"Operator key must be configured; no secret was printed.");
const checks=[];
const json=async(path,body,authenticated=true)=>{
  const response=await fetch(base+path,{method:body?"POST":"GET",headers:{origin:base,"content-type":"application/json",...(authenticated?{authorization:`Bearer ${key}`}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
  return {status:response.status,body:await response.json()};
};
const expect=(name,condition)=>{checks.push({name,passed:Boolean(condition)});assert.ok(condition,name);console.log(`PASS ${name}`);};
const before=await json("/api/health",undefined,false);
expect("production account store healthy before isolated drill",before.status===200&&before.body.services.accountStorage==="sqlite-reachable");
const anonymous=await json("/api/admin/recovery-drill",{action:"prepare"},false);
expect("anonymous recovery access rejected",anonymous.status===401);
const operations=await json("/api/admin/operations");
expect("operator dashboard reports readiness and recent metrics",operations.status===200&&operations.body.readiness&&Array.isArray(operations.body.recentMetrics));
const monitor=await json("/api/admin/monitor",{});
expect("monitor can probe storage without consuming inference credits",monitor.status===200&&monitor.body.database===true);
const prepared=await json("/api/admin/recovery-drill",{action:"prepare"});
expect("synthetic marker written after recovery bookmark",prepared.status===200&&prepared.body.marker==="synthetic-after");
const restore=await json("/api/admin/recovery-drill",{action:"restore"});
expect("synthetic-only recovery requested",restore.status===200&&restore.body.restoreRequested===true);
const verified=await json("/api/admin/recovery-drill",{action:"verify"});
expect("Cloudflare PITR restored the earlier synthetic marker",verified.status===200&&verified.body.recovered===true&&verified.body.marker==="synthetic-before");
const after=await json("/api/health",undefined,false);
expect("production account store remains healthy; release unchanged",after.status===200&&after.body.services.accountStorage==="sqlite-reachable"&&after.body.versionId===before.body.versionId);
const report={at:new Date().toISOString(),base,versionId:after.body.versionId,checks,readiness:operations.body.readiness,monitor:monitor.body,drill:verified.body,scope:"Real remote Cloudflare PITR on a separate synthetic-only object. No account backup was restored. Does not prove cross-account/provider disaster recovery, external alert delivery or human call quality."};
const directory=new URL(process.env.QA_DIRECTORY||"audit/2026-09-12-followup/",new URL("../../../",import.meta.url));
await mkdir(directory,{recursive:true});await writeFile(new URL("operations-smoke.json",directory),JSON.stringify(report,null,2));
