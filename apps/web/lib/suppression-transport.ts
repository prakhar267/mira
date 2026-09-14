import { appendRequestSchema, type SuppressionTransport } from "./suppression-protocol";

export interface SuppressionEnvironment {
  MIRA_SUPPRESSION_AUTHORITY_URL?:string;
  MIRA_SUPPRESSION_AUTHORITY_ID?:string;
  MIRA_SUPPRESSION_AUTHORITY_TOKEN?:string;
}

/** Dormant adapter. Endpoint and token must be provisioned server-side in an
 * approved independent failure domain. No browser-selected URL, ambient token,
 * redirect-following, fallback authority, or automatic service provisioning. */
export function suppressionTransport(env:SuppressionEnvironment, request:typeof fetch=fetch):SuppressionTransport|undefined {
  if(!env.MIRA_SUPPRESSION_AUTHORITY_URL&&!env.MIRA_SUPPRESSION_AUTHORITY_ID&&!env.MIRA_SUPPRESSION_AUTHORITY_TOKEN)return undefined;
  const url=new URL(env.MIRA_SUPPRESSION_AUTHORITY_URL??"");
  const token=env.MIRA_SUPPRESSION_AUTHORITY_TOKEN;
  const authorityId=env.MIRA_SUPPRESSION_AUTHORITY_ID;
  if(url.protocol!=="https:"||url.username||url.password||url.hash||url.search||url.port||!authorityId||!/^[A-Za-z0-9_-]{1,120}$/.test(authorityId)||!token||token.length<32||/[\r\n]/.test(token))throw new Error("SUPPRESSION_CONFIGURATION_INVALID");
  return {authorityId,async append(raw){
    const body=JSON.stringify(appendRequestSchema.parse(raw));
    const response=await request(url,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body,redirect:"error",cache:"no-store",signal:AbortSignal.timeout(4000)});
    if(!response.ok)throw new Error("SUPPRESSION_AUTHORITY_UNAVAILABLE");
    // A receipt is under 1 KB. Bound the body even if a broken service ignores
    // Content-Length. Never log a provider error body or authentication material.
    const reader=response.body?.getReader();
    if(!reader)throw new Error("SUPPRESSION_RECEIPT_INVALID");
    let text="",bytes=0;
    const decoder=new TextDecoder();
    try {
      for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>4096)throw new Error("SUPPRESSION_RECEIPT_INVALID");text+=decoder.decode(part.value,{stream:true});}
      text+=decoder.decode();return JSON.parse(text) as unknown;
    } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
  }};
}
