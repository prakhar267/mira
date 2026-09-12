import {requireOperator} from "@/lib/operations";
import {assertSameOrigin,accountErrorResponse} from "@/lib/account-server";
import {runOperationalMonitor} from "@/lib/operational-monitor";
import {monitorStore} from "@/lib/monitor-store";
export async function POST(request:Request) {
  try {assertSameOrigin(request);await requireOperator(request);const {env}=await import(/* webpackIgnore: true */ "cloudflare:workers");return Response.json(await runOperationalMonitor(env,monitorStore),{headers:{"cache-control":"no-store"}});}
  catch(error){return accountErrorResponse(error);}
}
