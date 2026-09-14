import { test, expect } from "@playwright/test";

// Stateful HTTP contract fixture: exercises real account UI, not production auth
// or storage. Worker integration tests cover the actual transaction handlers.
// Service-worker behavior is outside this HTTP-mocked account fixture.
test.use({ serviceWorkers: "block" });
test("account signup, login, conflict recovery, reauthenticated export and deletion", async ({ page, context }) => {
  test.setTimeout(120_000); // Ten-step onboarding plus cold development compilation.
  let state, revision = 1, signed = false, verified = false, deleted = false, conflict = false;
  const email = "synthetic-adult@example.test", password = "Synthetic-only-password-246!";
  const account = { id: "11111111-1111-4111-8111-111111111111", email, name: "Synthetic Adult" };
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/api/companion-")) return route.abort("blockedbyclient");
    return ["127.0.0.1", "localhost"].includes(url.hostname) ? route.continue() : route.abort();
  });
  const cookie = async () => context.addCookies([{ name: "__Host-companaro_session", value: "synthetic-session-only", domain: "127.0.0.1", path: "/", secure: true, httpOnly: true, sameSite: "Strict" }]);
  // WebKit does not send Secure cookies on this HTTP-loopback UI harness.
  // Supply only the mock-session header to the page proxy; real cookie security
  // is covered by Worker integration tests, never inferred from this fixture.
  await page.route(url => url.pathname === "/app", async route => {
    if (!signed) return route.continue();
    const response = await route.fetch({ headers: { ...route.request().headers(), cookie: "__Host-companaro_session=synthetic-session-only" } });
    return route.fulfill({ response });
  });
  await page.route("**/api/capabilities", route => route.fulfill({ json: { runtime: "cloudflare", mode: signed ? "account" : "anonymous", capabilities: { chat: signed, speech: signed, transcription: signed, voiceCall: signed, videoCall: signed, memoryRetrieval: false, imageUpload: false, imageGeneration: false, imageUnderstanding: false, journalReflection: false, scheduledNotifications: false, billing: false }, voice: { name: "Priya", customization: false } } }));
  await page.route("**/api/account/**", async route => {
    const url = new URL(route.request().url()), path = url.pathname.split("/").at(-1), method = route.request().method();
    const body = method !== "GET" && method !== "DELETE" ? route.request().postDataJSON() : {};
    const ok = json => route.fulfill({ json });
    if (path === "signup") {
      expect(body.policy).toMatchObject({ termsVersion: "2026-09-13", adultConfirmed: true, aiProcessingConsent: true });
      expect(body.email).toBe(email); state = structuredClone(body.state); state.user.id = account.id;
      signed = true; await cookie(); return ok({ account, state, revision });
    }
    if (path === "login") { expect(body).toEqual({ email, password }); signed = true; await cookie(); return ok({ account }); }
    if (path === "logout") { signed = false; await context.clearCookies(); return ok({ signedOut: true }); }
    if (!signed) return route.fulfill({ status: 401, json: { error: "Sign in to continue.", code: "SESSION_EXPIRED" } });
    if (path === "state" && method === "GET") return ok({ account, state, revision, policy: { termsVersion: "2026-09-13" } });
    if (path === "state" && method === "PUT") {
      if (conflict) { conflict = false; revision++; return route.fulfill({ status: 409, json: { error: "Another tab changed this account.", code: "STATE_CONFLICT", revision } }); }
      expect(body.revision).toBe(revision); state = structuredClone(body.state); revision++; return ok({ state, revision, saved: true });
    }
    if (path === "reauth") { expect(body.password).toBe(password); verified = true; return ok({ reauthenticated: true }); }
    if (path === "export") { expect(verified).toBe(true); verified = false; return ok({ schemaVersion: 1, state, account, exportedAt: new Date().toISOString() }); }
    if (path === "delete") { expect(verified).toBe(true); deleted = true; signed = false; await context.clearCookies(); return ok({ deleted: true }); }
    return route.fulfill({ status: 501, json: { error: `Unsupported fixture path ${path}` } });
  });
  await page.goto("/signup", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Begin setup", exact: true }).click();
  await page.getByLabel("First name", { exact: true }).fill("Synthetic Adult");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  const next = () => page.getByRole("button", { name: "Continue", exact: true }).click();
  await next(); await page.getByLabel("Birthday", { exact: true }).fill("1995-01-01");
  await page.getByRole("checkbox").check(); await next(); await next();
  await page.locator(".choice-grid button").first().click(); await next();
  await next(); await next(); await next();
  await page.locator(".choice-grid button").first().click(); await next();
  await page.getByRole("checkbox", { name: /I agree to my messages/ }).check();
  await page.getByRole("checkbox", { name: /I accept the/ }).check();
  await page.getByRole("button", { name: "Meet your companion", exact: true }).click();
  await expect(page.locator(".first-meeting")).toBeVisible();
  expect(signed).toBe(true); // Ensure signup went through this fixture, not local bindings.
  await page.locator(".first-meeting .luma-button").click();
  await expect(page.locator(".app-frame")).toBeVisible();
  await page.getByRole("button", { name: "You", exact: true }).click();
  await expect(page.locator(".account-sync-status")).toContainText("Saved to your account");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.locator(".app-frame")).toBeVisible();
  if (!await page.getByRole("heading", { name: "You", exact: true }).isVisible()) await page.getByRole("button", { name: "You", exact: true }).click();
  await expect(page.locator(".account-sync-status")).toContainText("Saved to your account");
  conflict = true;
  await page.getByLabel("Name", { exact: true }).fill("Unsaved synthetic draft");
  await expect(page.locator(".account-sync-status")).toContainText("Another tab changed this account");
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Discard unsaved changes and reload", exact: true }).click();
  await expect(page.locator(".app-frame")).toBeVisible();
  if (!await page.getByRole("heading", { name: "You", exact: true }).isVisible()) await page.getByRole("button", { name: "You", exact: true }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Synthetic Adult");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const reauth = page.getByRole("dialog", { name: "Confirm it’s you", exact: true });
  await reauth.getByLabel("Password", { exact: true }).fill(password);
  const download = page.waitForEvent("download");
  await reauth.getByRole("button", { name: "Confirm and continue", exact: true }).click(); await download;
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const deletion = page.getByRole("dialog", { name: "Delete your account?", exact: true });
  await deletion.getByRole("textbox").fill("DELETE"); await deletion.getByRole("button", { name: "Permanently delete", exact: true }).click();
  await reauth.getByLabel("Password", { exact: true }).fill(password);
  await reauth.getByRole("button", { name: "Confirm and continue", exact: true }).click();
  await expect(page).toHaveURL("http://127.0.0.1:4397/"); expect(deleted).toBe(true);
});
