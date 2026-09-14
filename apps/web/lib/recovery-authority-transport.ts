import {suppressionTransport,type SuppressionEnvironment} from "./suppression-transport";
import {boundedRecoveryJson,validAuthorityToken} from "./recovery-io";
import type {RecoveryAuthority} from "./protected-recovery-protocol";
export interface RecoveryTransportEnvironment extends SuppressionEnvironment {MIRA_RECOVERY_AUTHORITY_TOKEN?:string}

/** Explicit server configuration only; neither an archive nor operator JSON
 * selects an endpoint, credential or authority identity. No redirects/fallback. */
export function recoveryAuthorityTransport(env:RecoveryTransportEnvironment,request:typeof fetch=fetch):RecoveryAuthority{
  const transport=suppressionTransport(env,request),operator=env.MIRA_RECOVERY_AUTHORITY_TOKEN;
  if(!transport||!validAuthorityToken(operator)||operator===env.MIRA_SUPPRESSION_AUTHORITY_TOKEN)throw new Error("RECOVERY_AUTHORITY_CONFIGURATION_REQUIRED");
  const call=async(body:unknown,source=false)=>{
    const response=await request(env.MIRA_SUPPRESSION_AUTHORITY_URL!,{method:"POST",headers:{authorization:`Bearer ${source?env.MIRA_SUPPRESSION_AUTHORITY_TOKEN:operator}`,"content-type":"application/json"},body:JSON.stringify(body),redirect:"manual",cache:"no-store",signal:AbortSignal.timeout(4000)});
    if(!response.ok)throw new Error("RECOVERY_AUTHORITY_UNAVAILABLE");return boundedRecoveryJson(response);
  };
  return {authorityId:transport.authorityId,
    enroll:(source,writerId)=>call({operation:"enroll",source,writerId}),
    register:registration=>call({operation:"register",registration},true),
    handoff:request=>call({operation:"handoff",request}),
    read:(writer,after,limit)=>call({operation:"read",writer,after,limit}),
    admit:(handoff,checkpoint)=>call({operation:"admit",handoff,checkpoint}),
  };
}
