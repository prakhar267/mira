import {accountErrorResponse,assertSameOrigin,parseJsonObject,reauthenticate} from "@/lib/account-server";
export async function POST(request:Request){
  try{assertSameOrigin(request);const body=await parseJsonObject(request,2_000);await reauthenticate(request,body.password);return Response.json({reauthenticated:true},{headers:{"cache-control":"no-store"}});}catch(cause){return accountErrorResponse(cause);}
}
