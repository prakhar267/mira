import {MiraSuppressionAuthority} from "../../lib/recovery-authority-service.ts";
export const syntheticAuthorityConfiguration={MIRA_SUPPRESSION_AUTHORITY_ID:"synthetic-independent-authority",MIRA_SUPPRESSION_AUTHORITY_URL:"https://synthetic-authority.example.test/",MIRA_SUPPRESSION_AUTHORITY_TOKEN:"s".repeat(40),MIRA_RECOVERY_AUTHORITY_TOKEN:"o".repeat(40)};
export class SyntheticRecoveryAuthority extends MiraSuppressionAuthority {
  constructor(ctx,env){if(env.MIRA_LOCAL_TEST!=="synthetic-only")throw Error("Synthetic authority must not run in production");super(ctx,syntheticAuthorityConfiguration);}
}
