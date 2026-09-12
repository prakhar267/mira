import {describe,expect,it} from "vitest";
import {launchReadiness} from "./launch-readiness";
describe("commercial activation gates",()=>{
  it("does not confuse beta hosting or an enabled flag with a configured merchant",()=>{
    const result=launchReadiness({SITE_ORIGIN:"https://mira.example.workers.dev",BILLING_ENABLED:"true"});
    expect(result.domain.configured).toBe(false);expect(result.billing.configured).toBe(false);expect(result.billing.missing).toContain("DODO_PAYMENTS_WEBHOOK_KEY");expect(result.recovery.configured).toBe(false);
  });
  it("never exposes secrets or claims verified delivery from configuration",()=>{
    const result=launchReadiness({SITE_ORIGIN:"https://mira.example.com",RESEND_API_KEY:"secret",EMAIL_FROM:"Mira <hello@example.com>",MIRA_ALERT_WEBHOOK:"https://example.com/private-token"});
    expect(result.recovery.configured).toBe(true);expect(result.alerts.configured).toBe(true);expect(result.externalSignOffs).toContain("independent security review");expect(JSON.stringify(result)).not.toContain("private-token");expect(JSON.stringify(result)).not.toContain("secret");
  });
});
