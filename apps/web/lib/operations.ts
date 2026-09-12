import { AccountError, sha256 } from "./account-server";
export async function requireOperator(request:Request) {
  const {env}=await import(/* webpackIgnore: true */ "cloudflare:workers");
  const configured=env.MIRA_ADMIN_KEY;
  const supplied=request.headers.get("authorization")?.replace(/^Bearer /,"") ?? "";
  if(!configured)throw new AccountError("Operator access is not configured.",503);
  const [a,b]=await Promise.all([sha256(configured),sha256(supplied)]);
  let mismatch=0;for(let i=0;i<a.length;i++)mismatch |= a.charCodeAt(i)^b.charCodeAt(i);
  if(mismatch || !supplied)throw new AccountError("Operator authentication required.",401);
}
export function operationalAlerts(rows:Record<string,unknown>[]) {
  return rows.filter(r=>Number(r.total)>=10 && (Number(r.failures)/Number(r.total)>.05 || (String(r.name).startsWith("api:companion") && Number(r.averageLatencyMs)>6000))).map(r=>`${r.name}: ${r.failures}/${r.total} failed or limited; average ${r.averageLatencyMs}ms (${r.day}). Investigate provider status and quota.`);
}
