import {requireOperator} from "@/lib/operations";
import {AccountError,assertSameOrigin,accountErrorResponse,parseJsonObject} from "@/lib/account-server";
export async function POST(request:Request) {
  try {
    assertSameOrigin(request);await requireOperator(request);
    const {action}=await parseJsonObject(request,500);
    if(!["prepare","restore","verify"].includes(String(action)))throw new AccountError("Invalid drill step");
    const {env}=await import(/* webpackIgnore: true */ "cloudflare:workers");
    if(!env.MIRA_RECOVERY_TEST)throw new AccountError("Synthetic recovery binding is unavailable",503);
    const stub=env.MIRA_RECOVERY_TEST.get(env.MIRA_RECOVERY_TEST.idFromName("synthetic-only-v1"));
    const run=(step:string)=>stub.fetch("https://drill.internal/",{method:"POST",body:JSON.stringify({action:step})});
    if(action==="restore") {
      const armed=await run("arm");if(!armed.ok)throw new AccountError("Prepare the synthetic drill first",409);
      const {undoBookmark}=await armed.json() as {undoBookmark:string};
      try {await run("restart");}catch {/* ctx.abort deliberately closes this synthetic instance. */}
      return Response.json({restoreRequested:true,undoBookmark,scope:"synthetic-only; production accounts untouched"},{headers:{"cache-control":"no-store"}});
    }
    const result=await run(String(action));return new Response(result.body,{status:result.status,headers:{"content-type":"application/json","cache-control":"no-store"}});
  }catch(error){return accountErrorResponse(error);}
}
