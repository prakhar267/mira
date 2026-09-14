import { appendRequestSchema, type SuppressionTransport } from "./suppression-protocol";
import {boundedRecoveryJson,validAuthorityToken} from "./recovery-io";

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
  if(url.protocol!=="https:"||url.username||url.password||url.hash||url.search||url.port||!authorityId||!/^[A-Za-z0-9_-]{1,120}$/.test(authorityId)||!validAuthorityToken(token))throw new Error("SUPPRESSION_CONFIGURATION_INVALID");
  return {authorityId,async append(raw){
    const body=JSON.stringify(appendRequestSchema.parse(raw));
    const response=await request(url,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body,redirect:"manual",cache:"no-store",signal:AbortSignal.timeout(4000)});
    if(!response.ok)throw new Error("SUPPRESSION_AUTHORITY_UNAVAILABLE");
    // A receipt is under 1 KB. Bound the body even if a broken service ignores
    // Content-Length. Never log a provider error body or authentication material.
    try{return await boundedRecoveryJson(response,4096);}catch{throw new Error("SUPPRESSION_RECEIPT_INVALID");}
  }};
}
