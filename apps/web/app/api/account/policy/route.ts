import {acceptAccountPolicy,accountErrorResponse,assertSameOrigin,parseJsonObject,requireAccount} from "@/lib/account-server";
export async function POST(request:Request){
  try{assertSameOrigin(request);const {account}=await requireAccount(request);const body=await parseJsonObject(request,2_000);const result=await acceptAccountPolicy(account.id,body);return Response.json({state:result.state,revision:result.revision},{headers:{"cache-control":"no-store"}});}catch(cause){return accountErrorResponse(cause);}
}
