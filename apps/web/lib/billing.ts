import DodoPayments from "dodopayments";
import { AccountError } from "./account-server";
import { cloudStore } from "./cloud-store";
import {hasPaidAccess} from "./billing-access";
export async function billingConfig() {
  const { env } = await import(/* webpackIgnore: true */ "cloudflare:workers");
  const environment =
    env.DODO_PAYMENTS_ENVIRONMENT === "live_mode" ? "live_mode" : "test_mode";
  const enabled =
    env.BILLING_ENABLED === "true" &&
    Boolean(
      env.DODO_PAYMENTS_API_KEY &&
        env.DODO_PAYMENTS_WEBHOOK_KEY &&
        env.DODO_PRODUCT_ID &&
        env.BILLING_PRICE_LABEL &&
        env.SITE_ORIGIN,
    );
  return { env, environment, enabled } as const;
}
export async function billingClient() {
  const config = await billingConfig();
  if (!config.enabled)
    throw new AccountError(
      "Checkout is not enabled. Mira remains a free beta; no payment has been taken.",
      503,
    );
  return {
    ...config,
    client: new DodoPayments({
      bearerToken: config.env.DODO_PAYMENTS_API_KEY!,
      webhookKey: config.env.DODO_PAYMENTS_WEBHOOK_KEY!,
      environment: config.environment,
      timeout: 10000,
      maxRetries: 0,
    }),
  };
}
export async function billingEntitlement(userId: string) {
  const { enabled, environment } = await billingConfig();
  const raw = await cloudStore.get(`billing:${userId}`);
  const record = raw ? JSON.parse(raw) : null;
  const active = enabled && hasPaidAccess(record);
  // The existing beta includes voice/video. Keep that access when commerce is off.
  return {
    record,
    subscription: {
      planId: !enabled ? "platinum" : active ? "ultra" : "free",
      status: !enabled || active ? "active" : "inactive",
      testMode: !enabled || environment !== "live_mode",
      ...(record?.renewsAt ? { renewsAt: record.renewsAt } : {}),
    },
  };
}
