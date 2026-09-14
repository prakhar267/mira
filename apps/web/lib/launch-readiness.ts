export interface LaunchEnvironment {
  SITE_ORIGIN?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  MIRA_ALERT_WEBHOOK?: string;
  MIRA_SUPPORT_OWNER?: string;
  MIRA_BACKUP_KEY?: string;
  MIRA_BACKUP_KEY_ID?: string;
  BILLING_ENABLED?: string;
  DODO_PAYMENTS_ENVIRONMENT?: string;
  DODO_PAYMENTS_API_KEY?: string;
  DODO_PAYMENTS_WEBHOOK_KEY?: string;
  DODO_PRODUCT_ID?: string;
  BILLING_PRICE_LABEL?: string;
}
/** Reports configuration only, never secrets or claims of external approval. */
export function launchReadiness(env: LaunchEnvironment) {
  const present = (names: (keyof LaunchEnvironment)[]) => names.filter(name => !env[name]?.trim());
  let customDomain = false;
  try { const url = new URL(env.SITE_ORIGIN ?? ""); customDomain = url.protocol === "https:" && !url.hostname.endsWith(".workers.dev") && !url.hostname.endsWith(".vercel.app"); } catch { /* Missing origin. */ }
  const billingMissing = present(["DODO_PAYMENTS_API_KEY", "DODO_PAYMENTS_WEBHOOK_KEY", "DODO_PRODUCT_ID", "BILLING_PRICE_LABEL", "SITE_ORIGIN"]);
  return {
    domain: { configured: customDomain, action: customDomain ? "Verify DNS, TLS and all redirect URLs." : "Choose an owned Mira domain; the workers.dev beta remains available." },
    billing: { configured: !billingMissing.length, enabled: env.BILLING_ENABLED === "true", mode: env.DODO_PAYMENTS_ENVIRONMENT === "live_mode" ? "live_mode" : "test_mode", missing: billingMissing, action: "Correct Mira merchant, approved price and test-card lifecycle required before activation." },
    recovery: { configured: present(["RESEND_API_KEY","EMAIL_FROM","SITE_ORIGIN"]).length === 0, missing: present(["RESEND_API_KEY","EMAIL_FROM","SITE_ORIGIN"]), action: "Verify the sending domain and receive a real password-reset email." },
    alerts: { configured: Boolean(env.MIRA_ALERT_WEBHOOK), action: "Configure an approved HTTPS webhook; verify delivery and recovery notifications." },
    support: { ownerConfigured: Boolean(env.MIRA_SUPPORT_OWNER), action: "Confirm an on-call owner and response hours; dashboard availability is not staffed support." },
    backups: { encryptionConfigured: /^[A-Za-z0-9+/]{43}=$/.test(env.MIRA_BACKUP_KEY ?? "") && /^[A-Za-z0-9_-]{1,64}$/.test(env.MIRA_BACKUP_KEY_ID ?? ""), independentArchiveVerified: false, sourceLossRecoveryVerified: false, action: "Configure the encrypted archive key separately from an independent vault. Export and verify the deletion ledger independently. A surviving-source transfer drill is not proof of source-loss disaster recovery; require a trusted latest ledger and recorded production restore evidence." },
    externalSignOffs: ["real-device call acceptance", "independent security review", "legal and provider-retention review", "age-assurance decision", "GitHub Actions account access", "YouTube upload Terms approval"],
  };
}
