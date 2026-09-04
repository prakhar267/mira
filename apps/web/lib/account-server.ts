const sessionCookie = "__Host-companaro_session";
const sessionSeconds = 60 * 60 * 24 * 30;
// Cloudflare Workers WebCrypto currently caps a PBKDF2 call at 100,000 rounds.
const passwordIterations = 100_000;

interface AccountRecord {
  id: string;
  email: string;
  emailKey: string;
  name: string;
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;
  updatedAt: string;
}

interface SessionRecord {
  userId: string;
  createdAt: string;
}

async function store() {
  const { env } = await import(/* webpackIgnore: true */ "cloudflare:workers");
  if (!env.LUMA_ACCOUNTS) throw new Error("Production account storage is unavailable.");
  return env.LUMA_ACCOUNTS;
}

function stateCache() {
  return (caches as CacheStorage & { default: Cache }).default;
}

function stateCacheRequest(userId: string) {
  return new Request(`https://state.companaro.internal/${encodeURIComponent(userId)}`);
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

async function passwordHash(password: string, salt: Uint8Array) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", iterations: passwordIterations, salt: Uint8Array.from(salt).buffer }, key, 256);
  return bytesToBase64Url(new Uint8Array(bits));
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

function normalizedEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase().slice(0, 254) : "";
}

function cookieValue(request: Request, name: string) {
  const cookies = request.headers.get("cookie") ?? "";
  for (const part of cookies.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (origin && origin !== new URL(request.url).origin) throw new AccountError("That request did not come from this site.", 403);
  if (!origin && fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") throw new AccountError("That request did not come from this site.", 403);
}

export class AccountError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export function accountErrorResponse(cause: unknown) {
  const error = cause instanceof AccountError ? cause : new AccountError(cause instanceof Error ? cause.message : "Account service unavailable.", 503);
  return Response.json({ error: error.message }, { status: error.status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}

export async function parseJsonObject(request: Request, maximumBytes = 2_000_000) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maximumBytes) throw new AccountError("That request is too large.", 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maximumBytes) throw new AccountError("That request is too large.", 413);
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new AccountError("The request was not valid JSON."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AccountError("The request body is invalid.");
  return value as Record<string, unknown>;
}

export async function throttle(request: Request, scope: "login" | "signup", identity: string, maximum: number) {
  const kv = await store();
  const ip = request.headers.get("cf-connecting-ip") ?? "local";
  const key = `limit:${scope}:${await sha256(`${ip}:${identity}`)}`;
  const current = Number(await kv.get(key) ?? 0);
  if (current >= maximum) throw new AccountError("Too many attempts. Please wait fifteen minutes and try again.", 429);
  await kv.put(key, String(current + 1), { expirationTtl: 15 * 60 });
}

export async function createAccount(input: Record<string, unknown>) {
  const kv = await store();
  const email = normalizedEmail(input.email);
  const password = typeof input.password === "string" ? input.password : "";
  const name = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ").slice(0, 80) : "";
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new AccountError("Enter a valid email address.");
  if (password.length < 12 || password.length > 200) throw new AccountError("Use a password between 12 and 200 characters.");
  if (!name) throw new AccountError("Enter your name.");
  const emailKey = await sha256(email);
  if (await kv.get(`email:${emailKey}`)) throw new AccountError("An account with that email already exists.", 409);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const now = new Date().toISOString();
  const account: AccountRecord = {
    id: crypto.randomUUID(),
    email,
    emailKey,
    name,
    passwordHash: await passwordHash(password, salt),
    passwordSalt: bytesToBase64Url(salt),
    createdAt: now,
    updatedAt: now,
  };
  await Promise.all([
    kv.put(`account:${account.id}`, JSON.stringify(account)),
    kv.put(`email:${emailKey}`, account.id),
  ]);
  return account;
}

export async function authenticate(emailValue: unknown, passwordValue: unknown) {
  const kv = await store();
  const email = normalizedEmail(emailValue);
  const password = typeof passwordValue === "string" ? passwordValue : "";
  const emailKey = await sha256(email);
  const userId = await kv.get(`email:${emailKey}`);
  if (!userId) throw new AccountError("Email or password is incorrect.", 401);
  const raw = await kv.get(`account:${userId}`);
  if (!raw) throw new AccountError("Email or password is incorrect.", 401);
  const account = JSON.parse(raw) as AccountRecord;
  const candidate = await passwordHash(password, base64UrlToBytes(account.passwordSalt));
  if (!constantTimeEqual(candidate, account.passwordHash)) throw new AccountError("Email or password is incorrect.", 401);
  return account;
}

export async function createSession(account: AccountRecord) {
  const kv = await store();
  const token = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256(token);
  const session: SessionRecord = { userId: account.id, createdAt: new Date().toISOString() };
  await kv.put(`session:${tokenHash}`, JSON.stringify(session), { expirationTtl: sessionSeconds });
  return `${sessionCookie}=${token}; Max-Age=${sessionSeconds}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

export function clearSessionCookie() {
  return `${sessionCookie}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

export async function requireAccount(request: Request) {
  const kv = await store();
  const token = cookieValue(request, sessionCookie);
  if (!token) throw new AccountError("Please sign in to continue.", 401);
  const tokenHash = await sha256(token);
  const sessionRaw = await kv.get(`session:${tokenHash}`);
  if (!sessionRaw) throw new AccountError("Your session expired. Please sign in again.", 401);
  const session = JSON.parse(sessionRaw) as SessionRecord;
  const accountRaw = await kv.get(`account:${session.userId}`);
  if (!accountRaw) throw new AccountError("Your account could not be found.", 401);
  return { account: JSON.parse(accountRaw) as AccountRecord, tokenHash };
}

export async function readState(userId: string) {
  const cacheKey = stateCacheRequest(userId);
  const cached = await stateCache().match(cacheKey);
  if (cached) return await cached.json() as unknown;
  const raw = await (await store()).get(`state:${userId}`);
  if (!raw) throw new AccountError("Your companion profile could not be found.", 404);
  await stateCache().put(cacheKey, new Response(raw, { headers: { "cache-control": "max-age=600", "content-type": "application/json" } }));
  return JSON.parse(raw) as unknown;
}

export async function writeState(userId: string, state: unknown) {
  if (!state || typeof state !== "object" || Array.isArray(state)) throw new AccountError("Companion state is invalid.");
  const encoded = JSON.stringify(state);
  if (new TextEncoder().encode(encoded).byteLength > 2_000_000) throw new AccountError("Your account data is too large to sync. Remove large photo uploads and try again.", 413);
  await (await store()).put(`state:${userId}`, encoded);
  await stateCache().put(stateCacheRequest(userId), new Response(encoded, { headers: { "cache-control": "max-age=600", "content-type": "application/json" } }));
}

export async function revokeSession(tokenHash: string) {
  await (await store()).delete(`session:${tokenHash}`);
}

export async function deleteAccount(account: AccountRecord, tokenHash: string) {
  const kv = await store();
  await Promise.all([
    kv.delete(`session:${tokenHash}`),
    kv.delete(`state:${account.id}`),
    kv.delete(`email:${account.emailKey}`),
    kv.delete(`account:${account.id}`),
    stateCache().delete(stateCacheRequest(account.id)),
  ]);
}

export function publicAccount(account: AccountRecord) {
  return { id: account.id, email: account.email, name: account.name, createdAt: account.createdAt };
}
