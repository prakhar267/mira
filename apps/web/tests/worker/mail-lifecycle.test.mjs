import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { SELF, runInDurableObject, runDurableObjectAlarm, listDurableObjectIds } from "cloudflare:test";
import { cleanupWorkerState } from "./cleanup.mjs";
import { freshDemo } from "../../lib/demo-storage.ts";
import { sha256 } from "../../lib/account-server.ts";

const origin = "http://localhost:4173", password = "Synthetic-password-1234!", email = "mail-lifecycle@example.test";
const stub = () => env.MIRA_STORE.get(env.MIRA_STORE.idFromName("mira-production-v1"));
beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("External network forbidden in synthetic mail lifecycle tests"); })); });
afterEach(async () => {
  for (const id of await listDurableObjectIds(env.MIRA_STORE)) await runInDurableObject(env.MIRA_STORE.get(id), async instance => {
    if (instance.__mailOriginalEnv) instance.env = instance.__mailOriginalEnv;
  });
  await cleanupWorkerState(); vi.unstubAllGlobals();
});
async function action(data) { return (await stub().fetch("https://store.internal/", { method: "POST", body: JSON.stringify(data) })).json(); }
async function request(path, { method = "POST", body, cookie, ip = "192.0.2.77" } = {}) {
  const response = await SELF.fetch(`${origin}${path}`, { method, headers: { origin, "content-type": "application/json", "cf-connecting-ip": ip, ...(cookie ? { cookie } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return new Response(await response.arrayBuffer(), { status: response.status, headers: response.headers });
}
async function signup() {
  const state = freshDemo(); state.user.adultConfirmed = true; state.user.name = "Synthetic mail adult";
  const response = await request("/api/account/signup", { body: { email, password, name: state.user.name, state, policy: { termsVersion: "2026-09-13", adultConfirmed: true, aiProcessingConsent: true } } });
  const body = await response.json(); expect(response.status, JSON.stringify(body)).toBe(201);
  return { ...body, cookie: response.headers.get("set-cookie").split(";")[0] };
}
async function tokenRecord(userId, purpose, token, createdAt = Date.now()) {
  const key = `${purpose}:${await sha256(token)}`;
  await action({ action: "put", key, value: JSON.stringify({ userId, email, createdAt }), ttl: 900 }); return key;
}
const job = (suffix = "1") => ({ id: `synthetic-mail-lifecycle-${suffix}`, email, purpose: "recovery", token: "a".repeat(64), tokenHash: "synthetic-hash", createdAt: Date.now(), expiresAt: Date.now() + 900000, attempts: 0 });

describe("mail, recovery and verification in real Worker SQLite (synthetic only)", () => {
  it("returns the same unavailable recovery response for existing and absent addresses and never claims email sent", async () => {
    const user = await signup();
    const responses = await Promise.all([email, "absent-mail@example.test"].map(address => request("/api/account/forgot-password", { body: { email: address } })));
    expect(responses.map(response => response.status)).toEqual([503, 503]);
    const known = await responses[0].json(), absent = await responses[1].json();
    expect({ error: known.error, code: known.code }).toEqual({ error: absent.error, code: absent.code });
    expect(known.requestId).toBeTruthy(); expect(absent.requestId).toBeTruthy();
    const verification = await request("/api/account/request-verification", { cookie: user.cookie });
    expect(verification.status).toBe(503); expect((await verification.json()).error).toContain("No email has been sent");
    expect((await action({ action: "mailStatus" })).pending).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("runs the actual unconfigured alarm to erase expired queued secrets without sending pending jobs", async () => {
    const expired = job("expired"), pending = job("pending");
    await action({ action: "mailEnqueue", job: expired }); await action({ action: "mailEnqueue", job: pending });
    await runInDurableObject(stub(), (_instance, ctx) => ctx.storage.sql.exec("UPDATE mail_jobs SET expires=? WHERE id=?", Date.now() - 1, expired.id).toArray());
    expect(await runDurableObjectAlarm(stub())).toBe(true);
    const rows = await runInDurableObject(stub(), (_instance, ctx) => ctx.storage.sql.exec("SELECT id,attempts FROM mail_jobs").toArray());
    expect(rows).toEqual([{ id: pending.id, attempts: 0 }]); expect(fetch).not.toHaveBeenCalled();
  });
  it("records provider acceptance once and cannot replace the delivered token under the same idempotency key", async () => {
    await signup(); const queued = job("accept"); queued.tokenHash = await sha256(queued.token);
    const send = vi.fn(async (url, options) => {
      expect(String(url)).toBe("https://api.resend.com/emails");
      expect(new Headers(options.headers).get("idempotency-key")).toBe(`mira-recovery-${queued.id}`);
      return Response.json({ id: "synthetic-provider-acceptance" });
    }); vi.stubGlobal("fetch", send);
    await action({ action: "mailEnqueue", job: queued });
    await runInDurableObject(stub(), instance => { instance.__mailOriginalEnv = instance.env; instance.env = { ...instance.env, SITE_ORIGIN: "https://mira.example.test", RESEND_API_KEY: "synthetic-no-live-key", EMAIL_FROM: "test@example.test" }; });
    expect(await runDurableObjectAlarm(stub())).toBe(true); expect(send).toHaveBeenCalledOnce();
    expect((await action({ action: "mailStatus" })).pending).toBe(0);
    expect((await action({ action: "get", key: `recovery:${queued.tokenHash}` })).value).not.toBeNull();
    expect(await action({ action: "mailEnqueue", job: { ...queued, token: "b".repeat(64) } })).toEqual({ queued: true, duplicate: true });
    expect((await action({ action: "mailStatus" })).pending).toBe(0);
  });
  it("consumes reset tokens once, invalidates earlier tokens and rejects old account sessions", async () => {
    const user = await signup(), first = "1".repeat(64), second = "2".repeat(64), updated = "Synthetic-new-password-1234!";
    await tokenRecord(user.account.id, "recovery", first); await tokenRecord(user.account.id, "recovery", second);
    const resetResponse = await request("/api/account/reset-password", { body: { token: first, password: updated } });
    expect(resetResponse.status).toBe(200); expect(resetResponse.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await request("/api/account/reset-password", { body: { token: first, password: updated } })).status).toBe(400);
    expect((await request("/api/account/reset-password", { body: { token: second, password: updated } })).status).toBe(400);
    expect((await request("/api/account/state", { method: "GET", cookie: user.cookie })).status).toBe(401);
    expect((await request("/api/account/login", { body: { email, password } })).status).toBe(401);
    expect((await request("/api/account/login", { body: { email, password: updated } })).status).toBe(200);
  });
  it("verifies a matching owner once and rejects expired or changed-email capabilities", async () => {
    const user = await signup(), first = "3".repeat(64), expired = "4".repeat(64), foreign = "5".repeat(64);
    await tokenRecord(user.account.id, "verification", first);
    expect((await request("/api/account/verify-email", { body: { token: first } })).status).toBe(200);
    expect((await request("/api/account/verify-email", { body: { token: first } })).status).toBe(400);
    const expiredKey = await tokenRecord(user.account.id, "verification", expired);
    await runInDurableObject(stub(), (_instance, ctx) => ctx.storage.sql.exec("UPDATE records SET expires=? WHERE key=?", Date.now() - 1, expiredKey).toArray());
    expect((await request("/api/account/verify-email", { body: { token: expired } })).status).toBe(400);
    await action({ action: "put", key: `verification:${await sha256(foreign)}`, value: JSON.stringify({ userId: user.account.id, email: "other@example.test" }), ttl: 900 });
    expect((await request("/api/account/verify-email", { body: { token: foreign } })).status).toBe(400);
    const stored = JSON.parse((await action({ action: "get", key: `account:${user.account.id}` })).value); expect(stored.emailVerifiedAt).toBeTruthy();
  });
});
