import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import type { SqlStorage } from "./store-engine";
const runtime = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  pending: [] as Promise<unknown>[],
}));
import { env as testEnvironment } from "../tests/cloudflare-runtime";
runtime.env = testEnvironment;
vi.mock("next/server", () => ({
  after: (work: () => Promise<unknown>) => runtime.pending.push(work()),
}));
vi.mock("vinext/server/fetch-handler", () => ({
  default: { fetch: async () => new Response("framework") },
}));
import { MiraStore } from "../worker";
import { cloudStore, storeAction, CloudStoreError } from "./cloud-store";
import * as accounts from "./account-server";
import { freshDemo } from "./demo-storage";
import * as signup from "../app/api/account/signup/route";
import * as login from "../app/api/account/login/route";
import * as logout from "../app/api/account/logout/route";
import * as stateRoute from "../app/api/account/state/route";
import * as memory from "../app/api/account/memory/route";
import * as conversation from "../app/api/account/conversation/route";
import * as policy from "../app/api/account/policy/route";
import * as reauth from "../app/api/account/reauth/route";
import * as messages from "../app/api/account/messages/route";
import * as exportRoute from "../app/api/account/export/route";
import * as deleteRoute from "../app/api/account/delete/route";
import * as forgot from "../app/api/account/forgot-password/route";
import * as reset from "../app/api/account/reset-password/route";
import * as verify from "../app/api/account/verify-email/route";
import * as requestVerification from "../app/api/account/request-verification/route";
import * as health from "../app/api/health/route";
import * as support from "../app/api/support/route";
import * as events from "../app/api/events/route";
import { requestAccountMail } from "./mail-request";
import * as operationsRoute from "../app/api/admin/operations/route";
import * as monitorRoute from "../app/api/admin/monitor/route";
import { StateValidationError } from "./account-state-schema";

let db: DatabaseSync, store: MiraStore, cookie: string, sequence: number;
let alarm: number | null;
let options: ConstructorParameters<typeof MiraStore>[1];
const password = "Synthetic-password-123!";
const email = "synthetic@example.test";
function request(
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
  method = body === undefined ? "GET" : "POST",
) {
  return new Request(`https://mira.test/api/${path}`, {
    method,
    headers: {
      origin: "https://mira.test",
      cookie,
      "cf-connecting-ip": `synthetic-${sequence++}`,
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function signedUp() {
  const state = freshDemo();
  state.user.adultConfirmed = true;
  const response = await signup.POST(
    request("account/signup", {
      email,
      password,
      name: "Synthetic QA",
      state,
      policy: {
        termsVersion: "2026-09-13",
        adultConfirmed: true,
        aiProcessingConsent: state.aiProcessingConsent,
      },
    }),
  );
  expect(response.status, await response.clone().text()).toBe(201);
  cookie = response.headers.get("set-cookie")!.split(";")[0]!;
  return response.json() as Promise<{
    account: accounts.AccountRecord;
    state: typeof state;
    revision: number;
  }>;
}
beforeEach(async () => {
  sequence = 0;
  cookie = "";
  alarm = null;
  runtime.pending = [];
  for (const key of Object.keys(runtime.env)) delete runtime.env[key];
  db = new DatabaseSync(":memory:");
  const sql: SqlStorage = {
    exec(query, ...bindings) {
      const statement = db.prepare(query);
      const rows = statement.columns().length
        ? statement.all(...bindings)
        : (statement.run(...bindings), []);
      return { toArray: () => rows };
    },
  };
  let transaction = 0;
  const ctx: ConstructorParameters<typeof MiraStore>[0] = {
    storage: {
      sql,
      transactionSync<T>(work: () => T) {
        const name = `test_${transaction++}`;
        db.exec(`SAVEPOINT ${name}`);
        try {
          const result = work();
          db.exec(`RELEASE ${name}`);
          return result;
        } catch (error) {
          db.exec(`ROLLBACK TO ${name}`);
          db.exec(`RELEASE ${name}`);
          throw error;
        }
      },
      getAlarm: async () => alarm,
      setAlarm: async (time) => {
        alarm = time;
      },
    },
    blockConcurrencyWhile: async (work) => work(),
  };
  options = { SITE_ORIGIN: "https://mira.test" };
  store = new MiraStore(ctx, options);
  Object.assign(runtime.env, {
    SITE_ORIGIN: "https://mira.test",
    AI: {},
    MIRA_STORE: {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: (url: string, init: RequestInit) =>
          store.fetch(new Request(url, init)),
      }),
    },
  });
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockRejectedValue(
        Error("External network forbidden in account integration tests"),
      ),
  );
  await Promise.resolve();
});
afterEach(async () => {
  await Promise.allSettled(runtime.pending);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  db.close();
});

describe("account HTTP routes with real password hashing, sessions and SQLite", () => {
  it("creates, edits, exports and erases an account; old cookies lose access", async () => {
    const created = await signedUp();
    expect(cookie).toMatch(/^__Host-companaro_session=/);
    expect(created.account).not.toHaveProperty("passwordHash");
    let response = await stateRoute.GET(request("account/state"));
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"1"');
    const current = await response.json();
    current.state.user.name = "Updated QA";
    response = await stateRoute.PUT(
      request(
        "account/state",
        { state: current.state, revision: current.revision },
        {},
        "PUT",
      ),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).state.user.name).toBe("Updated QA");
    const stale = await stateRoute.PUT(
      request(
        "account/state",
        { state: current.state, revision: 1 },
        {},
        "PUT",
      ),
    );
    expect(stale.status).toBe(409);
    const exported = await exportRoute.GET(request("account/export"));
    expect(exported.status).toBe(200);
    expect(exported.headers.get("cache-control")).toBe("no-store");
    const payload = await exported.json();
    expect(payload.state.user.name).toBe("Updated QA");
    expect(payload.checksum).toBeTruthy();
    const deleted = await deleteRoute.DELETE(
      request("account/delete", undefined, {}, "DELETE"),
    );
    expect(deleted.status).toBe(200);
    expect(deleted.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await stateRoute.GET(request("account/state"))).status).toBe(401);
    expect(await cloudStore.get(`account:${created.account.id}`)).toBeNull();
  });
  it("logs in with the normalized email, reauthenticates and revokes only the current session", async () => {
    await signedUp();
    const firstCookie = cookie;
    const response = await login.POST(
      request("account/login", {
        email: "  SYNTHETIC@EXAMPLE.TEST  ",
        password,
      }),
    );
    expect(response.status).toBe(200);
    cookie = response.headers.get("set-cookie")!.split(";")[0]!;
    const result = await reauth.POST(request("account/reauth", { password }));
    expect(result.status).toBe(200);
    expect((await logout.POST(request("account/logout", {}))).status).toBe(200);
    expect((await stateRoute.GET(request("account/state"))).status).toBe(401);
    cookie = firstCookie;
    expect((await stateRoute.GET(request("account/state"))).status).toBe(200);
    expect(
      (await reauth.POST(request("account/reauth", { password: "wrong" })))
        .status,
    ).toBe(401);
  });
  it("requires fresh authentication for sensitive exports and accepts a renewed session", async () => {
    await signedUp();
    const current = await accounts.requireAccount(request("account/state"));
    await cloudStore.put(
      `session:${current.tokenHash}`,
      JSON.stringify({
        ...current.session,
        reauthenticatedAt: new Date(Date.now() - 11 * 60000).toISOString(),
      }),
    );
    expect((await exportRoute.GET(request("account/export"))).status).toBe(403);
    expect(
      (
        await deleteRoute.DELETE(
          request("account/delete", undefined, {}, "DELETE"),
        )
      ).status,
    ).toBe(403);
    expect(
      (await reauth.POST(request("account/reauth", { password }))).status,
    ).toBe(200);
    expect((await exportRoute.GET(request("account/export"))).status).toBe(200);
  });
  it("persists policy, explicit memories and conversation commands with revision checks", async () => {
    const account = await signedUp();
    const accepted = await policy.POST(
      request("account/policy", {
        termsVersion: "2026-09-13",
        adultConfirmed: true,
        aiProcessingConsent: true,
        memoryEnabled: true,
        conversationStorageEnabled: true,
        revision: account.revision,
      }),
    );
    expect(accepted.status).toBe(200);
    let current = await accepted.json();
    const saved = await memory.POST(
      request("account/memory", {
        command: {
          action: "create",
          type: "preference",
          content: "I like watercolor",
        },
        revision: current.revision,
      }),
    );
    expect(saved.status, await saved.clone().text()).toBe(200);
    current = await saved.json();
    expect(
      current.state.memories.some(
        (m: { content: string }) => m.content === "I like watercolor",
      ),
    ).toBe(true);
    const created = await conversation.POST(
      request("account/conversation", {
        command: { action: "create" },
        revision: current.revision,
      }),
    );
    expect(created.status).toBe(200);
    current = await created.json();
    const page = await messages.GET(
      request(
        `account/messages?conversationId=${current.state.activeConversationId}&limit=1`,
      ),
    );
    expect(page.status).toBe(200);
    const removed = await conversation.POST(
      request("account/conversation", {
        command: { action: "delete", id: current.state.activeConversationId },
        revision: current.revision,
      }),
    );
    expect(removed.status).toBe(200);
    expect((await messages.GET(request("account/messages"))).status).toBe(200);
  });
  it.each([
    "limit=0",
    "limit=201",
    "limit=1.2",
    "conversationId=../x",
    "cursor=null",
    "cursor={}",
    "cursor=[1,2]",
    "cursor=[]",
    `cursor=${"x".repeat(301)}`,
  ])("rejects malformed transcript pagination: %s", async (query) => {
    await signedUp();
    expect(
      (await messages.GET(request(`account/messages?${query}`))).status,
    ).toBeGreaterThanOrEqual(400);
  });
  it("accepts a valid transcript cursor and rejects invalid state bodies without mutating storage", async () => {
    await signedUp();
    expect(
      (
        await messages.GET(
          request(
            `account/messages?cursor=${encodeURIComponent(JSON.stringify([new Date().toISOString(), "m"]))}`,
          ),
        )
      ).status,
    ).toBe(200);
    for (const state of [null, [], "bad"])
      expect(
        (
          await stateRoute.PUT(
            request("account/state", { state, revision: 1 }, {}, "PUT"),
          )
        ).status,
      ).toBe(503);
  });
  it.each([
    ["signup", signup.POST],
    ["login", login.POST],
    ["logout", logout.POST],
    ["memory", memory.POST],
    ["conversation", conversation.POST],
    ["policy", policy.POST],
    ["reauth", reauth.POST],
    ["forgot-password", forgot.POST],
    ["reset-password", reset.POST],
    ["verify-email", verify.POST],
    ["request-verification", requestVerification.POST],
  ] as const)("rejects cross-origin writes for %s", async (path, handle) => {
    expect(
      (
        await handle(
          request(`account/${path}`, {}, { origin: "https://other.test" }),
        )
      ).status,
    ).toBe(403);
  });
  it("does not disclose missing accounts in login failures or password-reset responses", async () => {
    expect(
      (await login.POST(request("account/login", { email, password }))).status,
    ).toBe(401);
    expect((await login.POST(request("account/login", {}))).status).toBe(401);
    Object.assign(runtime.env, {
      RESEND_API_KEY: "synthetic",
      EMAIL_FROM: "Mira <qa@example.test>",
    });
    const response = await forgot.POST(
      request("account/forgot-password", { email }),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect((await response.json()).accepted).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("account validation and canonical state boundaries", () => {
  it.each([
    { email: "bad" },
    { email: 5 },
    { password: "short" },
    { password: null },
    { password: "x".repeat(201) },
    { name: "  " },
    { name: null },
  ])(
    "rejects invalid credentials before committing an account: %j",
    async (input) => {
      const state = freshDemo();
      state.user.adultConfirmed = true;
      await expect(
        accounts.bootstrapAccount({
          email,
          password,
          name: "QA",
          ...input,
          state,
          policy: {
            termsVersion: "2026-09-13",
            adultConfirmed: true,
            aiProcessingConsent: state.aiProcessingConsent,
          },
        }),
      ).rejects.toBeInstanceOf(accounts.AccountError);
      expect((await cloudStore.list({ prefix: "account:" })).keys).toEqual([]);
    },
  );
  it("enforces age, policy version, unique email and bounded beta capacity", async () => {
    const state = freshDemo();
    state.user.adultConfirmed = false;
    await expect(
      accounts.bootstrapAccount({ email, password, name: "QA", state }),
    ).rejects.toMatchObject({ code: "ADULT_DECLARATION_REQUIRED" });
    state.user.adultConfirmed = true;
    await expect(
      accounts.bootstrapAccount({ email, password, name: "QA", state }),
    ).rejects.toMatchObject({ code: "POLICY_CONFIRMATION_REQUIRED" });
    await signedUp();
    await expect(
      accounts.bootstrapAccount({
        email,
        password,
        name: "QA",
        state,
        policy: {
          termsVersion: "2026-09-13",
          adultConfirmed: true,
          aiProcessingConsent: state.aiProcessingConsent,
        },
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_EXISTS" });
    Object.assign(options, { MIRA_BETA_ACCOUNT_LIMIT: "1" });
    await expect(
      accounts.bootstrapAccount({
        email: "second@example.test",
        password,
        name: "QA",
        state,
        policy: {
          termsVersion: "2026-09-13",
          adultConfirmed: true,
          aiProcessingConsent: state.aiProcessingConsent,
        },
      }),
    ).rejects.toMatchObject({ code: "BETA_CAPACITY" });
  });
  it("requires a supported hash algorithm and safely rejects missing or corrupt account records", async () => {
    const result = await signedUp();
    const account = (await accounts.requireAccount(request("x"))).account;
    expect((await accounts.authenticate(email, password)).id).toBe(account.id);
    for (const overrides of [
      { passwordAlgorithm: "unknown" },
      { passwordIterations: 100001 },
      { passwordHash: "broken" },
    ]) {
      await cloudStore.put(
        `account:${account.id}`,
        JSON.stringify({ ...account, ...overrides }),
      );
      await expect(
        accounts.authenticate(email, password),
      ).rejects.toBeInstanceOf(accounts.AccountError);
    }
    const legacy = { ...account };
    delete legacy.passwordAlgorithm;
    delete legacy.passwordIterations;
    await cloudStore.put(`account:${account.id}`, JSON.stringify(legacy));
    expect((await accounts.authenticate(email, password)).id).toBe(
      result.account.id,
    );
    await expect(
      accounts.authenticate(email, "x".repeat(201)),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await expect(
      accounts.authenticate(email, "wrong password"),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await cloudStore.delete(`account:${account.id}`);
    await expect(accounts.requireAccount(request("x"))).rejects.toMatchObject({
      status: 401,
    });
  });
  it.each([
    {},
    { userId: "../x", createdAt: new Date().toISOString() },
    { userId: "user", createdAt: "bad" },
    { userId: "user", createdAt: "2000-01-01T00:00:00Z" },
    { userId: "user", createdAt: "2099-01-01T00:00:00Z" },
  ])("rejects invalid stored sessions: %j", async (session) => {
    cookie = "__Host-companaro_session=synthetic";
    await cloudStore.put(
      `session:${await accounts.sha256("synthetic")}`,
      JSON.stringify(session),
    );
    await expect(accounts.requireAccount(request("x"))).rejects.toMatchObject({
      code: "SESSION_EXPIRED",
    });
  });
  it("invalidates old sessions after a password change and rejects future reauthentication timestamps", async () => {
    await signedUp();
    const auth = await accounts.requireAccount(request("x"));
    await cloudStore.put(
      `session:${auth.tokenHash}`,
      JSON.stringify({
        ...auth.session,
        reauthenticatedAt: "2099-01-01T00:00:00Z",
      }),
    );
    await expect(
      accounts.requireRecentAccount(request("x")),
    ).rejects.toMatchObject({ code: "REAUTH_REQUIRED" });
    await cloudStore.put(
      `account:${auth.account.id}`,
      JSON.stringify({
        ...auth.account,
        passwordChangedAt: new Date().toISOString(),
      }),
    );
    await expect(accounts.requireAccount(request("x"))).rejects.toMatchObject({
      status: 401,
    });
  });
  it("preserves valid session cookies among unrelated cookies and validates cookie origin rules", async () => {
    await signedUp();
    cookie = `other=value; ${cookie}; another=1`;
    expect((await accounts.requireAccount(request("x"))).account.email).toBe(
      email,
    );
    const noOrigin = (site?: string) =>
      new Request("https://mira.test/x", {
        headers: site ? { "sec-fetch-site": site } : {},
      });
    for (const site of [undefined, "same-origin", "none"])
      expect(() => accounts.assertSameOrigin(noOrigin(site))).not.toThrow();
    expect(() => accounts.assertSameOrigin(noOrigin("cross-site"))).toThrow(
      /site/,
    );
  });
  it("translates storage failures into safe error codes and rejects malformed mutation commands", async () => {
    for (const [code, status] of [
      ["TRANSCRIPT_LIMIT", 413],
      ["CONVERSATION_REMOVED", 409],
      ["OTHER", 503],
    ] as const)
      expect(
        accounts.accountErrorResponse(new CloudStoreError(500, code)).status,
      ).toBe(status);
    expect(
      accounts.accountErrorResponse(new StateValidationError("invalid")).status,
    ).toBe(400);
    expect(accounts.accountErrorResponse("private failure").status).toBe(503);
    await expect(
      accounts.mutateMemory("missing", { action: "invalid" } as never, 1),
    ).rejects.toMatchObject({ code: "INVALID_MEMORY" });
    for (const input of [
      null,
      {},
      { action: "update" },
      { action: "delete", id: "../x" },
      { action: "delete" },
    ])
      await expect(
        accounts.mutateConversation("missing", input, 1),
      ).rejects.toMatchObject({ code: "INVALID_CONVERSATION" });
    await expect(
      accounts.acceptAccountPolicy("missing", {}),
    ).rejects.toMatchObject({ code: "INVALID_POLICY" });
    const user = await signedUp();
    await expect(
      accounts.writeState(user.account.id, user.state, 0),
    ).rejects.toMatchObject({ code: "REVISION_REQUIRED" });
    await expect(
      accounts.writeState("missing", user.state, 1),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(accounts.readState("missing")).rejects.toMatchObject({
      code: "STATE_NOT_FOUND",
    });
    expect((await accounts.readState(user.account.id)).user.id).toBe(
      user.account.id,
    );
  });
  it("bounds the JSON parser and rejects absent, invalid, array and scalar payloads", async () => {
    for (const text of ["{", "null", "[]", "1", '"x"'])
      await expect(
        accounts.parseJsonObject(
          new Request("https://mira.test", { method: "POST", body: text }),
        ),
      ).rejects.toBeInstanceOf(accounts.AccountError);
    await expect(
      accounts.parseJsonObject(new Request("https://mira.test")),
    ).rejects.toThrow(/missing/);
    await expect(
      accounts.parseJsonObject(
        request("x", { long: "x" }, { "content-length": "100" }),
        10,
      ),
    ).rejects.toMatchObject({ status: 413 });
    await expect(
      accounts.parseJsonObject(request("x", { long: "x".repeat(100) }), 10),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    expect(
      await accounts.parseJsonObject(request("x", { accepted: true })),
    ).toEqual({ accepted: true });
  });
});

describe("account mail, health, support and telemetry without external traffic", () => {
  it("queues verification, verifies once, resets a password once and fences previous sessions", async () => {
    const user = await signedUp();
    Object.assign(runtime.env, {
      RESEND_API_KEY: "synthetic",
      EMAIL_FROM: "Mira <qa@example.test>",
    });
    expect(
      (
        await requestVerification.POST(
          request("account/request-verification", {}),
        )
      ).status,
    ).toBe(200);
    const token = "a".repeat(64),
      key = await accounts.sha256(token);
    await cloudStore.put(
      `verification:${key}`,
      JSON.stringify({ userId: user.account.id, email, createdAt: Date.now() }),
      { expirationTtl: 900 },
    );
    expect(
      (await verify.POST(request("account/verify-email", { token }))).status,
    ).toBe(200);
    expect(
      (await verify.POST(request("account/verify-email", { token }))).status,
    ).toBe(400);
    await cloudStore.put(
      `recovery:${key}`,
      JSON.stringify({ userId: user.account.id, email, createdAt: Date.now() }),
      { expirationTtl: 900 },
    );
    const changed = await reset.POST(
      request("account/reset-password", {
        token,
        password: "A-new-synthetic-password1!",
      }),
    );
    expect(changed.status).toBe(200);
    await expect(accounts.authenticate(email, password)).rejects.toMatchObject({
      status: 401,
    });
    expect(
      (await accounts.authenticate(email, "A-new-synthetic-password1!")).id,
    ).toBe(user.account.id);
    expect(
      (await reset.POST(request("account/reset-password", { token, password })))
        .status,
    ).toBe(400);
    expect((await stateRoute.GET(request("account/state"))).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("reports unavailable mail honestly and validates mail inputs", async () => {
    await expect(requestAccountMail(email, "recovery", {})).rejects.toThrow(
      /not configured/,
    );
    for (const body of [{}, { email: "bad" }, { email: 1 }])
      expect((await forgot.POST(request("x", body))).status).toBe(400);
    for (const body of [{}, { token: "bad" }, { token: 1 }])
      expect((await verify.POST(request("x", body))).status).toBe(400);
    for (const body of [
      {},
      { token: "bad", password },
      { token: "a".repeat(64), password: 1 },
      { token: "a".repeat(64), password: "short" },
    ])
      expect((await reset.POST(request("x", body))).status).toBe(400);
    expect((await requestVerification.POST(request("x", {}))).status).toBe(401);
  });
  it("reports configured health, missing inference and unavailable storage separately", async () => {
    expect((await health.GET()).status).toBe(200);
    delete runtime.env.AI;
    expect((await health.GET()).status).toBe(503);
    delete runtime.env.MIRA_STORE;
    expect((await health.GET()).status).toBe(503);
  });
  it("stores a bounded support report and only allowlisted anonymous events", async () => {
    const response = await support.POST(
      request("support", {
        summary: "Synthetic issue",
        details: "A detailed synthetic reproduction",
        email,
        page: "/app",
      }),
    );
    expect(response.status).toBe(201);
    const { ticketId } = await response.json();
    expect(
      JSON.parse((await cloudStore.get(`support:${ticketId}`))!).email,
    ).toBe(email);
    expect(
      (
        await support.POST(
          request("support", {
            summary: "Another issue",
            details: "A detailed synthetic reproduction",
          }),
        )
      ).status,
    ).toBe(201);
    for (const body of [
      null,
      {},
      { summary: 1, details: 1 },
      { summary: "Valid summary", details: "Valid long details", email: "bad" },
      {
        summary: "Valid summary",
        details: "Valid long details",
        page: "x".repeat(121),
      },
    ])
      expect((await support.POST(request("support", body))).status).toBe(400);
    expect(
      (
        await events.POST(
          request("events", { event: "reply_misunderstood", durationMs: 200 }),
        )
      ).status,
    ).toBe(204);
    expect(
      (
        await events.POST(
          request("events", {
            event: "reply_misunderstood",
            durationMs: "invalid",
          }),
        )
      ).status,
    ).toBe(204);
    for (const body of [null, {}, { event: "private_message" }])
      expect((await events.POST(request("events", body))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("applies IP and identity limits without starting provider work", async () => {
    const req = request("login", {}, { "cf-connecting-ip": "same-ip" });
    await accounts.throttle(req, "login", "one", 1);
    await expect(
      accounts.throttle(req, "login", "two", 1),
    ).rejects.toMatchObject({ status: 429 });
    await expect(
      accounts.throttle(request("login"), "login", "one", 1),
    ).rejects.toMatchObject({ status: 429 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("exposes safe storage diagnostics and rejects invalid or unprepared selected targets", async () => {
    await cloudStore.put("one", "1");
    await cloudStore.put("two", "2", { expirationTtl: 5 });
    expect((await cloudStore.list({ limit: 1 })).list_complete).toBe(false);
    expect((await cloudStore.list()).keys.length).toBeGreaterThan(1);
    for (const action of [
      "metrics",
      "recentMetrics",
      "capacity",
      "storageStats",
      "mailStatus",
    ])
      expect(await storeAction({ action })).toBeTruthy();
    await expect(storeAction({ action: "unknown" })).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
    });
    runtime.env.MIRA_STORE_OBJECT_NAME = "invalid";
    await expect(cloudStore.get("one")).rejects.toMatchObject({
      code: "RECOVERY_TARGET_CONFIGURATION_INVALID",
    });
    runtime.env.MIRA_STORE_OBJECT_NAME = "mira-recovery-unprepared";
    await expect(cloudStore.get("one")).rejects.toBeInstanceOf(CloudStoreError);
    delete runtime.env.MIRA_STORE_OBJECT_NAME;
    delete runtime.env.MIRA_STORE;
    await expect(cloudStore.get("one")).rejects.toThrow(/unavailable/);
  });
});

describe("real store alarms, legacy migration and private operator routes", () => {
  it("lazily imports valid legacy records but blocks expired sessions and deleted owners", async () => {
    const old = new Map<string, string>([
      ["account:legacy", JSON.stringify({ id: "legacy" })],
      ["session:old", JSON.stringify({ createdAt: "2020-01-01T00:00:00Z" })],
      ["session:new", JSON.stringify({ createdAt: new Date().toISOString() })],
      [
        "support:MIRA-OLD",
        JSON.stringify({ createdAt: "2020-01-01T00:00:00Z" }),
      ],
      [
        "support:MIRA-NEW",
        JSON.stringify({
          createdAt: new Date().toISOString(),
          summary: "Legacy",
        }),
      ],
      ["backup:legacy:2020-01-01", JSON.stringify(freshDemo())],
      ["state:legacy", JSON.stringify(freshDemo())],
    ]);
    options.LUMA_ACCOUNTS = {
      get: vi.fn(async (key) => old.get(key) ?? null),
      delete: vi.fn(async (key) => {
        old.delete(key);
      }),
      list: vi.fn(async () => ({ keys: [], list_complete: true })),
    };
    expect(await cloudStore.get("account:legacy")).toContain("legacy");
    expect(await cloudStore.get("session:old")).toBeNull();
    expect(await cloudStore.get("session:new")).toBeTruthy();
    expect(await cloudStore.get("support:MIRA-OLD")).toBeNull();
    expect(await cloudStore.get("support:MIRA-NEW")).toContain("Legacy");
    expect(await cloudStore.get("backup:legacy:2020-01-01")).toBeNull();
    expect(await cloudStore.get("state:legacy")).toBeTruthy();
    await cloudStore.delete("account:deleted");
    old.set("state:deleted", JSON.stringify(freshDemo()));
    expect(await cloudStore.get("state:deleted")).toBeNull();
  });
  it("bounds paginated migration and retries legacy purges through the real alarm", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const createdAt = new Date().toISOString();
    const legacyDelete = vi
        .fn()
        .mockRejectedValueOnce(Error("temporary"))
        .mockResolvedValue(undefined),
      legacyList = vi
        .fn()
        .mockResolvedValueOnce({
          keys: [{ name: "support:MIRA-MIGRATED" }],
          list_complete: false,
          cursor: "next",
        })
        .mockResolvedValue({ keys: [], list_complete: true });
    options.LUMA_ACCOUNTS = {
      get: vi.fn(async (key) =>
        key === "support:MIRA-MIGRATED"
          ? JSON.stringify({ createdAt, summary: "Imported" })
          : null,
      ),
      delete: legacyDelete,
      list: legacyList,
    };
    await cloudStore.put("temporary", "old");
    await cloudStore.delete("temporary");
    await cloudStore.list({ prefix: "support:" });
    await store.alarm();
    expect(await cloudStore.get("temporary")).toBeNull();
    expect(await cloudStore.get("support:MIRA-MIGRATED")).toContain("Imported");
    expect(legacyList).toHaveBeenCalledWith({ prefix: "support:", limit: 25 });
    await store.alarm();
    expect(legacyDelete).toHaveBeenCalledTimes(2);
    expect(legacyList).toHaveBeenLastCalledWith({
      prefix: "support:",
      limit: 25,
      cursor: "next",
    });
    expect(await cloudStore.get("ops:monitor")).toBeTruthy();
    expect(alarm).toBeGreaterThan(Date.now());
    await cloudStore.put(
      "purge-prefix:qa",
      JSON.stringify({ prefix: "backup:qa:" }),
    );
    legacyList.mockResolvedValueOnce({
      keys: [{ name: "backup:qa:2026-09-26" }],
      list_complete: false,
      cursor: "more",
    });
    await store.alarm();
    expect(legacyDelete).toHaveBeenCalledWith("backup:qa:2026-09-26");
    await store.alarm();
    await cloudStore.put(
      "migration:support:",
      JSON.stringify({ prefix: "support:" }),
    );
    await cloudStore.put(
      "purge-prefix:qa",
      JSON.stringify({ prefix: "backup:qa:" }),
    );
    delete options.LUMA_ACCOUNTS;
    await store.alarm();
    expect(await cloudStore.get("migration:support:")).toBeNull();
    expect(await cloudStore.get("purge-prefix:qa")).toBeNull();
    log.mockRestore();
  });
  it("delivers synthetic queued mail through a mocked transport and retries provider failures", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const user = await signedUp();
    Object.assign(options, {
      RESEND_API_KEY: "synthetic",
      EMAIL_FROM: "QA <qa@example.test>",
    });
    const job = {
      id: "job".repeat(12),
      email,
      purpose: "recovery",
      token: "x".repeat(64),
      tokenHash: await accounts.sha256("x".repeat(64)),
      createdAt: Date.now() + 1,
      expiresAt: Date.now() + 900000,
      attempts: 0,
    };
    await storeAction({ action: "mailEnqueue", job });
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ id: "synthetic-mail" }),
    );
    await store.alarm();
    expect(fetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({ method: "POST" }),
    );
    expect(await storeAction({ action: "mailStatus" })).toMatchObject({
      pending: 0,
    });
    expect(await cloudStore.get(`recovery:${job.tokenHash}`)).toContain(
      user.account.id,
    );
    await storeAction({
      action: "mailEnqueue",
      job: {
        ...job,
        id: "retry".repeat(10),
        purpose: "verification",
        token: "y".repeat(64),
        tokenHash: await accounts.sha256("y".repeat(64)),
      },
    });
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("provider unavailable", { status: 503 }),
    );
    await store.alarm();
    expect(await storeAction({ action: "mailStatus" })).toMatchObject({
      pending: 1,
    });
    expect(alarm).toBeLessThan(Date.now() + 90000);
    log.mockRestore();
  });
  it("runs operator authentication, inbox pagination, updates and local monitoring against actual SQLite", async () => {
    const ops = operationsRoute,
      monitor = monitorRoute;
    expect((await ops.GET(request("admin/operations"))).status).toBe(503);
    runtime.env.MIRA_ADMIN_KEY = "synthetic-operator";
    expect((await ops.GET(request("admin/operations"))).status).toBe(401);
    const headers = { authorization: "Bearer synthetic-operator" };
    const ticket = {
      ticketId: "MIRA-QA-TEST",
      summary: "Synthetic issue",
      details: "Synthetic detail",
      status: "new",
      createdAt: new Date().toISOString(),
    };
    await cloudStore.put("support:MIRA-QA-TEST", JSON.stringify(ticket));
    const response = await ops.GET(
      request("admin/operations?cursor=", undefined, headers),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect((await response.json()).tickets).toHaveLength(1);
    expect(
      (
        await ops.PATCH(
          request(
            "admin/operations",
            { ticketId: ticket.ticketId, status: "resolved" },
            headers,
            "PATCH",
          ),
        )
      ).status,
    ).toBe(200);
    expect(
      JSON.parse((await cloudStore.get("support:MIRA-QA-TEST"))!).status,
    ).toBe("resolved");
    for (const body of [
      { ticketId: "bad", status: "resolved" },
      { ticketId: "MIRA-MISSING", status: "resolved" },
      { ticketId: ticket.ticketId, status: "bad" },
    ])
      expect(
        (await ops.PATCH(request("admin/operations", body, headers, "PATCH")))
          .status,
      ).toBeGreaterThanOrEqual(400);
    await cloudStore.put(
      "support:MIRA-EXPIRED",
      JSON.stringify({ ...ticket, createdAt: "2020-01-01T00:00:00Z" }),
    );
    expect(
      (
        await ops.PATCH(
          request(
            "admin/operations",
            { ticketId: "MIRA-EXPIRED", status: "resolved" },
            headers,
            "PATCH",
          ),
        )
      ).status,
    ).toBe(404);
    expect(
      (await monitor.POST(request("admin/monitor", {}, headers))).status,
    ).toBe(200);
    expect(
      (
        await monitor.POST(
          request(
            "admin/monitor",
            {},
            { ...headers, origin: "https://other.test" },
          ),
        )
      ).status,
    ).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps backup/recovery operations explicitly targeted, gated and synthetic", async () => {
    const backup = await import("../app/api/admin/backup/route"),
      drill = await import("../app/api/admin/recovery-drill/route");
    runtime.env.MIRA_ADMIN_KEY = "synthetic-operator";
    const headers = { authorization: "Bearer synthetic-operator" };
    for (const body of [
      { target: 3 },
      { target: "production-other" },
      { operation: "retire", target: "mira-recovery-synthetic" },
    ])
      expect(
        (await backup.POST(request("admin/backup", body, headers))).status,
      ).toBe(400);
    expect(
      (await backup.POST(request("admin/backup", {}, headers))).status,
    ).toBe(503);
    Object.assign(runtime.env, {
      MIRA_BACKUP_KEY: Buffer.alloc(32, 7).toString("base64"),
      MIRA_BACKUP_KEY_ID: "synthetic",
    });
    Object.assign(options, {
      MIRA_BACKUP_KEY: Buffer.alloc(32, 7).toString("base64"),
      MIRA_BACKUP_KEY_ID: "synthetic",
    });
    expect(
      (await backup.POST(request("admin/backup", { version: 2 }, headers)))
        .status,
    ).toBe(503);
    expect(
      (await backup.POST(request("admin/backup", { version: 1 }, headers)))
        .status,
    ).toBe(400);
    expect(
      (
        await backup.POST(
          request("admin/backup", { operation: "status" }, headers),
        )
      ).status,
    ).toBe(200);
    runtime.env.MIRA_PROTECTED_RECOVERY_ENABLED = "true";
    expect(
      (
        await backup.POST(
          request("admin/backup", { version: 2, operation: "status" }, headers),
        )
      ).status,
    ).toBe(503);
    expect(
      (
        await drill.POST(
          request("admin/recovery-drill", { action: "bad" }, headers),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await drill.POST(
          request("admin/recovery-drill", { action: "prepare" }, headers),
        )
      ).status,
    ).toBe(503);
    const call = vi.fn().mockResolvedValue(Response.json({ prepared: true }));
    runtime.env.MIRA_RECOVERY_TEST = {
      idFromName: (name: string) => name,
      get: () => ({ fetch: call }),
    };
    expect(
      (
        await drill.POST(
          request("admin/recovery-drill", { action: "prepare" }, headers),
        )
      ).status,
    ).toBe(200);
    call.mockResolvedValueOnce(new Response("Not prepared", { status: 409 }));
    expect(
      (
        await drill.POST(
          request("admin/recovery-drill", { action: "restore" }, headers),
        )
      ).status,
    ).toBe(409);
    call
      .mockResolvedValueOnce(
        Response.json({ undoBookmark: "synthetic-bookmark" }),
      )
      .mockRejectedValueOnce(Error("Intentional restart"));
    const restored = await drill.POST(
      request("admin/recovery-drill", { action: "restore" }, headers),
    );
    expect(restored.status).toBe(200);
    expect((await restored.json()).scope).toContain("synthetic-only");
  });
  it("creates and revokes demo sessions only with the current explicit declarations", async () => {
    const demo = await import("../app/api/demo/session/route");
    const input = {
      adultDeclared: true,
      aiProcessingConsent: true,
      memoryConsent: false,
      policyVersion: "2026-09-13",
    };
    for (const body of [
      null,
      [],
      {},
      { ...input, unexpected: true },
      { ...input, adultDeclared: false },
      { ...input, aiProcessingConsent: false },
      { ...input, memoryConsent: 1 },
      { ...input, policyVersion: "old" },
    ])
      expect((await demo.POST(request("demo/session", body))).status).toBe(400);
    const response = await demo.POST(request("demo/session", input));
    expect(response.status).toBe(201);
    cookie = response.headers.get("set-cookie")!.split(";")[0]!;
    expect(
      (
        await demo.DELETE(request("demo/session", undefined, {}, "DELETE"))
      ).headers.get("set-cookie"),
    ).toContain("Max-Age=0");
    expect(
      (
        await demo.DELETE(
          request(
            "demo/session",
            undefined,
            { origin: "https://other.test" },
            "DELETE",
          ),
        )
      ).status,
    ).toBe(403);
  });
});

describe("reminder actions and alarms through the actual store", () => {
  it("encrypts a synthetic push, records delivery, preserves VAPID keys and clears subscriptions", async () => {
    const { pushBase64 } = await import("./reminder-delivery");
    const { DEFAULT_REMINDER } = await import("./reminders");
    const created = await signedUp(),
      userId = created.account.id;
    const initial = await storeAction<import("./reminders").ReminderSnapshot>({
      action: "remindersRead",
      userId,
    });
    expect(initial.publicKey.length).toBe(87);
    expect(
      (
        await storeAction<import("./reminders").ReminderSnapshot>({
          action: "remindersRead",
          userId,
        })
      ).publicKey,
    ).toBe(initial.publicKey);
    const key = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    );
    const device = {
      endpoint: "https://fcm.googleapis.com/fcm/send/synthetic",
      keys: {
        p256dh: pushBase64(
          new Uint8Array(await crypto.subtle.exportKey("raw", key.publicKey)),
        ),
        auth: pushBase64(crypto.getRandomValues(new Uint8Array(16))),
      },
    };
    await storeAction({
      action: "remindersSubscribe",
      userId,
      id: "synthetic-device",
      device,
    });
    const rule = {
      ...DEFAULT_REMINDER,
      id: "daily",
      kind: "daily",
      timezone: "UTC",
      quietStart: "00:00",
      quietEnd: "00:00",
    };
    await storeAction({ action: "remindersSave", userId, rule });
    db.prepare("UPDATE reminder_rules SET next_at=?").run(Date.now() - 1000);
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 201 }));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await store.alarm();
    log.mockRestore();
    expect(fetch).toHaveBeenCalledWith(
      device.endpoint,
      expect.objectContaining({ method: "post" }),
    );
    const delivered = await storeAction<import("./reminders").ReminderSnapshot>(
      { action: "remindersRead", userId },
    );
    expect(delivered.rules[0]?.status).toBe("sent");
    expect(delivered.rules[0]?.nextAt).toBeGreaterThan(Date.now());
    await storeAction({ action: "remindersDelete", userId, id: "daily" });
    await storeAction({
      action: "remindersUnsubscribe",
      userId,
      id: "synthetic-device",
    });
    await storeAction({ action: "remindersUnsubscribe", userId });
    expect(
      await storeAction({ action: "remindersRead", userId }),
    ).toMatchObject({ devices: [], rules: [] });
    expect(
      await storeAction({ action: "remindersUnknown", userId }),
    ).toMatchObject({ error: "Unknown reminder action." });
    expect(
      await storeAction({ action: "remindersRead", userId: "missing" }),
    ).toMatchObject({ error: "Your account is unavailable." });
  });
  it("refuses mismatched configured targets before any state mutation", async () => {
    options.MIRA_STORE_OBJECT_NAME = "mira-recovery-synthetic";
    const response = await store.fetch(
      new Request("https://store.test", {
        method: "POST",
        body: JSON.stringify({
          action: "put",
          key: "unsafe",
          value: "no",
          selectedTarget: "mira-production-v1",
        }),
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "RECOVERY_TARGET_CONFIGURATION_INVALID",
    });
  });
});

describe("store dispatch budget and account error contracts", () => {
  it("reserves inference idempotently, releases leases and routes search and billing to SQLite", async () => {
    const created = await signedUp(),
      userId = created.account.id;
    expect(
      await storeAction({
        action: "claimEmail",
        key: "email:synthetic-new",
        account: { id: "new" },
      }),
    ).toEqual({ created: true });
    expect(
      await storeAction({
        action: "transcriptSearch",
        userId,
        options: { query: "tea", limit: 20 },
      }),
    ).toEqual({ messages: [] });
    expect(
      await storeAction({
        action: "transcriptContext",
        userId,
        messageId: "missing",
      }),
    ).toEqual({ messages: [] });
    const input = {
      action: "inferenceReserve",
      service: "chat",
      tier: "account",
      principal: userId,
      attemptId: "attempt",
      units: 1,
      max: 600,
      personalMax: 180,
      unitMax: 2400000,
      personalUnitMax: 720000,
      demoMax: 240,
      concurrency: 2,
      globalConcurrency: 12,
      demoConcurrency: 4,
      ttl: 40,
    };
    expect(await storeAction(input)).toMatchObject({ allowed: true });
    expect(await storeAction(input)).toMatchObject({ allowed: true });
    expect(
      await storeAction({ action: "inferenceRelease", attemptId: "attempt" }),
    ).toEqual({ ok: true });
    await storeAction({
      action: "billing",
      key: "synthetic-billing",
      userId,
      timestamp: new Date().toISOString(),
      subscription: { status: "active" },
    });
    expect(
      JSON.parse((await cloudStore.get(`billing:${userId}`))!).status,
    ).toBe("active");
    await storeAction({ action: "metric", name: "synthetic-default-duration" });
    expect(
      await storeAction({
        action: "eraseAccount",
        userId: "missing",
        emailKey: "missing",
      }),
    ).toMatchObject({ keys: expect.any(Array) });
  });
  it("reports a recovered account verification fence as a 403 storage contract", async () => {
    const created = await signedUp(),
      userId = created.account.id;
    const account = JSON.parse((await cloudStore.get(`account:${userId}`))!);
    await cloudStore.put(
      `account:${userId}`,
      JSON.stringify({ ...account, recoveryVerificationRequired: true }),
    );
    await expect(
      storeAction({
        action: "acceptPolicy",
        userId,
        policy: {
          aiProcessingConsent: true,
          memoryEnabled: true,
          conversationStorageEnabled: true,
        },
        revision: 1,
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: "ACCOUNT_VERIFICATION_REQUIRED",
    });
  });
});

describe("route abuse limits preserve account and mail boundaries", () => {
  beforeEach(() => {
    // Filling a fixed-window bucket must not straddle the wall-clock boundary.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-26T12:00:30Z"));
  });
  it.each([
    ["account/forgot-password", "recovery", 4, forgot.POST],
    [
      "account/request-verification",
      "verification",
      3,
      requestVerification.POST,
    ],
    ["account/reset-password", "password-reset", 10, reset.POST],
    ["account/verify-email", "verify-email", 10, verify.POST],
    ["events", "events", 60, events.POST],
    ["support", "support", 4, support.POST],
  ] as const)(
    "returns 429 for exhausted %s before processing input",
    async (path, scope, max, handler) => {
      await signedUp();
      const { edgeRateLimited } = await import("./edge-security");
      const headers = { "cf-connecting-ip": "synthetic-rate-boundary" };
      for (let n = 0; n < max; n++)
        expect(
          await edgeRateLimited(
            request(path, {}, headers),
            scope,
            max,
            path === "events" ? 60 : path === "support" ? 3600 : 900,
          ),
        ).toBe(false);
      const response = await handler(request(path, {}, headers));
      expect(response.status).toBe(429);
      expect(
        db.prepare("SELECT count(*) AS n FROM mail_jobs").get(),
      ).toMatchObject({ n: 0 });
    },
  );
  it("limits recovery by normalized address even when the client address changes", async () => {
    await signedUp();
    for (let n = 0; n < 3; n++)
      await storeAction({
        action: "rate",
        key: `mail:${await accounts.sha256(email)}`,
        max: 3,
        seconds: 900,
      });
    const response = await forgot.POST(
      request("account/forgot-password", { email: email.toUpperCase() }),
    );
    expect(response.status).toBe(429);
    expect(
      db.prepare("SELECT count(*) AS n FROM mail_jobs").get(),
    ).toMatchObject({ n: 0 });
  });
});
