import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  rows: new Map<string, string>(),
  account: vi.fn(),
  limited: vi.fn(),
  create: vi.fn(),
  portal: vi.fn(),
  unwrap: vi.fn(),
  mutation: vi.fn(),
  sdk: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({ env: fixture.env }));
vi.mock("./cloud-store", async (original) => ({
  ...(await original<typeof import("./cloud-store")>()),
  cloudStore: {
    get: vi.fn(async (key: string) => fixture.rows.get(key) ?? null),
  },
  storeAction: fixture.mutation,
}));
vi.mock("./account-server", async (original) => ({
  ...(await original<typeof import("./account-server")>()),
  requireAccount: fixture.account,
}));
vi.mock("./edge-security", () => ({ edgeRateLimited: fixture.limited }));
vi.mock("dodopayments", () => ({
  default: class {
    constructor(config: unknown) {
      fixture.sdk(config);
    }
    checkoutSessions = { create: fixture.create };
    customers = { customerPortal: { create: fixture.portal } };
    webhooks = { unwrap: fixture.unwrap };
  },
}));
import { billingClient, billingConfig, billingEntitlement } from "./billing";
import * as checkout from "../app/api/billing/checkout/route";
import * as portal from "../app/api/billing/portal/route";
import * as status from "../app/api/billing/status/route";
import * as webhook from "../app/api/billing/webhook/route";
import { AccountError } from "./account-server";
const id = "a0000000-0000-4000-8000-000000000001";
const req = (body = "{}", headers: Record<string, string> = {}) =>
  new Request("https://mira.test/api/billing/checkout", {
    method: "POST",
    headers: { origin: "https://mira.test", ...headers },
    body,
  });
const enable = () =>
  Object.assign(fixture.env, {
    BILLING_ENABLED: "true",
    DODO_PAYMENTS_API_KEY: "synthetic-api-key",
    DODO_PAYMENTS_WEBHOOK_KEY: "synthetic-webhook-key",
    DODO_PRODUCT_ID: "synthetic-product",
    BILLING_PRICE_LABEL: "Test price",
    SITE_ORIGIN: "https://mira.test",
  });
const event = () => ({
  type: "subscription.active",
  timestamp: new Date().toISOString(),
  data: {
    metadata: { app_user_id: id },
    product_id: "synthetic-product",
    subscription_id: "subscription",
    customer: { customer_id: "customer" },
    status: "active",
    next_billing_date: new Date(Date.now() + 86400000).toISOString(),
    cancel_at_next_billing_date: false,
  },
});
beforeEach(() => {
  vi.resetAllMocks();
  fixture.rows.clear();
  for (const key of Object.keys(fixture.env)) delete fixture.env[key];
  fixture.account.mockResolvedValue({
    account: { id, email: "qa@example.test", name: "QA" },
  });
  fixture.limited.mockResolvedValue(false);
  fixture.create.mockResolvedValue({
    checkout_url: "https://checkout.example.test/review",
  });
  fixture.portal.mockResolvedValue({
    link: "https://checkout.example.test/portal",
  });
  fixture.unwrap.mockReturnValue(event());
  fixture.mutation.mockResolvedValue({ ok: true });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(Error("No external payment traffic")),
  );
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
describe("billing routes with isolated provider boundaries", () => {
  it("defaults to disabled free-beta access and requires a complete billing configuration", async () => {
    expect(await billingConfig()).toMatchObject({
      enabled: false,
      environment: "test_mode",
    });
    await expect(billingClient()).rejects.toMatchObject({ status: 503 });
    expect((await billingEntitlement(id)).subscription).toMatchObject({
      planId: "platinum",
      testMode: true,
    });
    expect((await checkout.POST(req())).status).toBe(503);
    enable();
    fixture.env.DODO_PAYMENTS_ENVIRONMENT = "live_mode";
    expect(await billingConfig()).toMatchObject({
      enabled: true,
      environment: "live_mode",
    });
    expect((await billingEntitlement(id)).subscription).toMatchObject({
      planId: "free",
      testMode: false,
    });
  });
  it("creates checkout for a signed-in account with server-owned product and account metadata", async () => {
    enable();
    expect((await checkout.POST(req())).status).toBe(200);
    expect(fixture.create).toHaveBeenCalledWith(
      expect.objectContaining({
        product_cart: [{ product_id: "synthetic-product", quantity: 1 }],
        customer: { email: "qa@example.test", name: "QA" },
        metadata: { app_user_id: id },
        return_url: "https://mira.test/app?billing=return",
      }),
    );
    expect(fixture.sdk).toHaveBeenCalledWith(
      expect.objectContaining({
        maxRetries: 0,
        timeout: 10000,
        environment: "test_mode",
      }),
    );
    fixture.rows.set(
      `billing:${id}`,
      JSON.stringify({ customerId: "existing", status: "cancelled" }),
    );
    await checkout.POST(req());
    expect(fixture.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ customer: { customer_id: "existing" } }),
    );
  });
  it.each(["active", "on_hold"])(
    "prevents duplicate checkout for an %s subscription",
    async (state) => {
      enable();
      fixture.rows.set(
        `billing:${id}`,
        JSON.stringify({
          status: state,
          renewsAt: new Date(Date.now() + 86400000).toISOString(),
        }),
      );
      expect((await checkout.POST(req())).status).toBe(409);
      expect(fixture.create).not.toHaveBeenCalled();
    },
  );
  it("enforces authentication, origin and checkout frequency", async () => {
    enable();
    fixture.account.mockRejectedValueOnce(new AccountError("Sign in", 401));
    expect((await checkout.POST(req())).status).toBe(401);
    expect(
      (await checkout.POST(req("{}", { origin: "https://other.test" }))).status,
    ).toBe(403);
    fixture.limited.mockResolvedValueOnce(true);
    expect((await checkout.POST(req())).status).toBe(429);
    fixture.create.mockRejectedValueOnce(Error("Private provider error"));
    expect((await checkout.POST(req())).status).toBe(503);
  });
  it("opens the customer portal only for an existing billing customer", async () => {
    enable();
    expect((await portal.POST(req())).status).toBe(404);
    fixture.rows.set(
      `billing:${id}`,
      JSON.stringify({
        customerId: "existing",
        status: "active",
        subscriptionId: "sub",
        renewsAt: new Date(Date.now() + 86400000).toISOString(),
      }),
    );
    const response = await portal.POST(req());
    expect(await response.json()).toEqual({
      url: "https://checkout.example.test/portal",
    });
    expect(fixture.portal).toHaveBeenCalledWith("existing", {
      return_url: "https://mira.test/app",
    });
    const snapshot = await status.GET(req());
    expect(await snapshot.json()).toMatchObject({
      enabled: true,
      signedIn: true,
      hasSubscription: true,
      subscription: { planId: "ultra" },
    });
  });
  it("returns public billing configuration without exposing account data to signed-out users", async () => {
    fixture.account.mockRejectedValueOnce(new AccountError("Sign in", 401));
    expect(await (await status.GET(req())).json()).toMatchObject({
      enabled: false,
      signedIn: false,
      hasSubscription: false,
      priceLabel: null,
    });
  });
  it("bounds webhook size and rejects disabled or unverifiable callbacks", async () => {
    expect(
      (await webhook.POST(req("x", { "content-length": "262145" }))).status,
    ).toBe(413);
    expect((await webhook.POST(req("x".repeat(262145)))).status).toBe(413);
    expect((await webhook.POST(req())).status).toBe(503);
    enable();
    fixture.unwrap.mockImplementationOnce(() => {
      throw Error("Bad signature");
    });
    expect((await webhook.POST(req())).status).toBe(401);
    expect(fixture.mutation).not.toHaveBeenCalled();
  });
  it.each([
    "non-subscription",
    "missing-user",
    "bad-user",
    "wrong-product",
    "bad-date",
    "missing-subscription",
  ])(
    "ignores or rejects invalid verified webhook content: %s",
    async (kind) => {
      enable();
      const payload = event();
      if (kind === "non-subscription") payload.type = "payment.succeeded";
      if (kind === "missing-user") payload.data.metadata = {} as never;
      if (kind === "bad-user") payload.data.metadata.app_user_id = "../other";
      if (kind === "wrong-product") payload.data.product_id = "wrong";
      if (kind === "bad-date") payload.timestamp = "invalid";
      if (kind === "missing-subscription") payload.data.subscription_id = "";
      fixture.unwrap.mockReturnValueOnce(payload);
      const response = await webhook.POST(req());
      expect(response.status).toBe(
        ["bad-date", "missing-subscription"].includes(kind) ? 400 : 200,
      );
      expect(fixture.mutation).not.toHaveBeenCalled();
    },
  );
  it("mutates only existing accounts after verification and asks for retry on storage failure", async () => {
    enable();
    expect((await webhook.POST(req())).status).toBe(200);
    expect(fixture.mutation).not.toHaveBeenCalled();
    fixture.rows.set(`account:${id}`, JSON.stringify({ id }));
    expect(
      (
        await webhook.POST(
          req("signed payload", {
            "webhook-id": "event-id",
            "webhook-timestamp": "123",
            "webhook-signature": "synthetic-signature",
          }),
        )
      ).status,
    ).toBe(200);
    expect(fixture.unwrap).toHaveBeenLastCalledWith("signed payload", {
      headers: {
        "webhook-id": "event-id",
        "webhook-timestamp": "123",
        "webhook-signature": "synthetic-signature",
      },
    });
    expect(fixture.mutation).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "billing",
        key: "event-id",
        userId: id,
        subscription: expect.objectContaining({
          customerId: "customer",
          status: "active",
        }),
      }),
    );
    fixture.mutation.mockRejectedValueOnce(Error("Unavailable"));
    expect((await webhook.POST(req())).status).toBe(503);
    const minimal = event();
    delete (minimal.data as { customer?: unknown }).customer;
    fixture.unwrap.mockReturnValueOnce(minimal);
    expect((await webhook.POST(req())).status).toBe(200);
  });
});
