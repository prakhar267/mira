import {accountErrorResponse,assertSameOrigin,mutateMemory,parseJsonObject,requireAccount} from "@/lib/account-server";
import type {MemoryCommand} from "@/lib/account-state-schema";
export async function POST(request:Request){
  try{assertSameOrigin(request);const {account}=await requireAccount(request);const body=await parseJsonObject(request,8_000);const result=await mutateMemory(account.id,body.command as MemoryCommand,body.revision);return Response.json({state:result.state,revision:result.revision},{headers:{"cache-control":"no-store"}});}catch(cause){return accountErrorResponse(cause);}
}
