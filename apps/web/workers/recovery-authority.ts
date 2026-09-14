import {MiraSuppressionAuthority,type RecoveryAuthorityServiceEnvironment} from "../lib/recovery-authority-service";
export {MiraSuppressionAuthority};
interface Environment extends RecoveryAuthorityServiceEnvironment {
  MIRA_SUPPRESSION_STATE:{idFromName(name:string):string;get(id:string):{fetch(request:Request):Promise<Response>}};
}
/** Separately deployable, NOT included in any current Wrangler configuration.
 * The operator must choose independent durable placement and retained custody;
 * adding this source file never provisions or activates a service. */
const authorityWorker={fetch(request:Request,env:Environment){
  if(!env.MIRA_SUPPRESSION_STATE||!env.MIRA_SUPPRESSION_AUTHORITY_ID)return Response.json({code:"RECOVERY_AUTHORITY_CONFIGURATION_REQUIRED"},{status:503});
  return env.MIRA_SUPPRESSION_STATE.get(env.MIRA_SUPPRESSION_STATE.idFromName(env.MIRA_SUPPRESSION_AUTHORITY_ID)).fetch(request);
}};
export default authorityWorker;
