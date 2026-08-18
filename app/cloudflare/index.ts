import { generateReply } from "./gemini.ts";
import { assessSafety } from "./safety.ts";
export { UserStateCoordinator } from "./user-state.ts";
import type {
  Actor,
  DemoState,
  Env,
  ExecutionContextLike,
} from "./types.ts";

const API_VERSION = "1.0.0";
const SESSION_COOKIE = "saathkind_session";
const MAX_JSON_BYTES = 64 * 1024;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const BETA_LIFETIME_MESSAGE_LIMIT = 300;
const BETA_USAGE_PERIOD = "beta-lifetime";
const BETA_RESOURCE_LIMITS = { conversations: 300, memories: 100, followups: 100, goals: 100, consentEvents: 500 } as const;

const volatileStates = new Map<string, DemoState>();
const volatileSessions = new Map<string, string>();
const volatileRates = new Map<string, { hits: number; expiresAt: number }>();

class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type RequestContext = {
  request: Request;
  env: Env;
  actor: Actor;
  state: DemoState;
  requestId: string;
  url: URL;
  path: string;
  segments: string[];
};

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
const bool = (value: unknown, fallback = false) => (typeof value === "boolean" ? value : fallback);
const text = (value: unknown, max: number, fallback = "") =>
  typeof value === "string" ? value.trim().slice(0, max) : fallback;

function rollUsagePeriod(state: DemoState): boolean {
  if (state.usagePeriod === BETA_USAGE_PERIOD) return false;
  state.usagePeriod = BETA_USAGE_PERIOD;
  state.usage = {};
  return true;
}

function baseHeaders(requestId: string): Headers {
  return new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    "x-request-id": requestId,
  });
}

function json(data: unknown, requestId: string, status = 200, extra?: HeadersInit): Response {
  const headers = baseHeaders(requestId);
  if (extra) new Headers(extra).forEach((value, key) => headers.set(key, value));
  return new Response(JSON.stringify({ ok: status < 400, ...(status < 400 ? { data } : data) }), { status, headers });
}

function noContent(requestId: string): Response {
  const headers = baseHeaders(requestId);
  headers.delete("content-type");
  return new Response(null, { status: 204, headers });
}

function errorResponse(error: unknown, requestId: string): Response {
  if (error instanceof ApiError) {
    return json(
      { error: { code: error.code, message: error.message, requestId, ...(error.details ? { details: error.details } : {}) } },
      requestId,
      error.status,
    );
  }
  console.error(JSON.stringify({ level: "error", requestId, message: error instanceof Error ? error.message : "unknown" }));
  return json(
    { error: { code: "internal_error", message: "Something went wrong. Please try again.", requestId } },
    requestId,
    500,
  );
}

function allowedOrigins(env: Env, requestUrl: URL): Set<string> {
  return new Set(
    [requestUrl.origin, ...(env.CORS_ORIGINS || "").split(",")]
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function applyCors(response: Response, request: Request, env: Env): Response {
  const origin = request.headers.get("origin");
  if (!origin) return response;
  const url = new URL(request.url);
  if (!allowedOrigins(env, url).has(origin)) return response;
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-credentials", "true");
  headers.append("vary", "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function apiPath(pathname: string): string | null {
  if (pathname === "/api") return "/";
  if (pathname.startsWith("/api/v1/")) return pathname.slice(7);
  if (pathname === "/api/v1") return "/";
  if (pathname.startsWith("/api/")) return pathname.slice(4);
  return null;
}

function cookie(request: Request, name: string): string | null {
  const source = request.headers.get("cookie") || "";
  for (const part of source.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function tokenFrom(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) return authorization.slice(7).trim();
  return cookie(request, SESSION_COOKIE);
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_JSON_BYTES) throw new ApiError(413, "payload_too_large", "Request body is too large.");
  if (!request.body) return {};
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let raw = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_JSON_BYTES) {
        await reader.cancel("payload_too_large").catch(() => undefined);
        throw new ApiError(413, "payload_too_large", "Request body is too large.");
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("object required");
    return parsed as Record<string, unknown>;
  } catch {
    throw new ApiError(400, "invalid_json", "Body must be a valid JSON object.");
  }
}

function isTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function validateClock(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function stateKey(tenantId: string, userId: string) {
  return `state:${tenantId}:${userId}`;
}

function userStateStub(env: Env, tenantId: string, userId: string) {
  if (!env.USER_STATE) return null;
  return env.USER_STATE.get(env.USER_STATE.idFromName(`${tenantId}:${userId}`));
}

async function readCoordinatedState(
  env: Env,
  tenantId: string,
  userId: string,
): Promise<{ state: DemoState; revision: number } | "missing" | "deleted"> {
  const stub = userStateStub(env, tenantId, userId);
  if (!stub) return "missing";
  let response: Response;
  try {
    response = await stub.fetch("https://user-state.internal/state");
  } catch {
    throw new ApiError(503, "state_coordinator_unavailable", "Account coordination is temporarily unavailable.");
  }
  if (response.status === 404) return "missing";
  if (response.status === 410) return "deleted";
  if (!response.ok) throw new ApiError(503, "persistence_unavailable", "Could not load your account state.");
  return (await response.json()) as { state: DemoState; revision: number };
}

async function initializeCoordinatedState(
  env: Env,
  state: DemoState,
  session: { tokenHash: string; sessionId: string; expiresAt: number },
): Promise<number> {
  const stub = userStateStub(env, state.tenantId, state.user.id);
  if (!stub) return 0;
  let response: Response;
  try {
    response = await stub.fetch("https://user-state.internal/initialize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state, session }),
    });
  } catch {
    throw new ApiError(503, "state_coordinator_unavailable", "Account coordination is temporarily unavailable.");
  }
  if (response.status === 410) throw new ApiError(410, "account_deleted", "This beta account was deleted.");
  if (!response.ok) throw new ApiError(503, "persistence_unavailable", "Could not initialize your account state.");
  const payload = (await response.json()) as { revision: number };
  return payload.revision;
}

async function validateCoordinatedSession(env: Env, actor: Actor): Promise<void> {
  const stub = userStateStub(env, actor.tenantId, actor.userId);
  if (!stub) throw new ApiError(503, "state_coordinator_unavailable", "Account coordination is unavailable.");
  let response: Response;
  try {
    response = await stub.fetch("https://user-state.internal/session/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tokenHash: actor.tokenHash, sessionId: actor.sessionId }),
    });
  } catch {
    throw new ApiError(503, "state_coordinator_unavailable", "Account coordination is temporarily unavailable.");
  }
  if (response.status === 401 || response.status === 410) {
    throw new ApiError(401, "invalid_session", "Your session is invalid or expired.");
  }
  if (!response.ok) throw new ApiError(503, "persistence_unavailable", "Could not validate your session.");
}

async function revokeCoordinatedSession(env: Env, actor: Actor): Promise<void> {
  const stub = userStateStub(env, actor.tenantId, actor.userId);
  if (!stub) throw new ApiError(503, "state_coordinator_unavailable", "Account coordination is unavailable.");
  let response: Response;
  try {
    response = await stub.fetch("https://user-state.internal/session/revoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tokenHash: actor.tokenHash, sessionId: actor.sessionId }),
    });
  } catch {
    throw new ApiError(503, "state_coordinator_unavailable", "Account coordination is temporarily unavailable.");
  }
  if (!response.ok) throw new ApiError(503, "persistence_unavailable", "Could not revoke your session.");
}

async function commitCoordinatedState(env: Env, actor: Actor, state: DemoState): Promise<number> {
  const stub = userStateStub(env, actor.tenantId, actor.userId);
  if (!stub || !Number.isInteger(actor.stateRevision)) {
    throw new ApiError(503, "persistence_unavailable", "Account coordination is unavailable.");
  }
  let response: Response;
  try {
    response = await stub.fetch("https://user-state.internal/state", {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": String(actor.stateRevision) },
      body: JSON.stringify(state),
    });
  } catch {
    throw new ApiError(503, "state_coordinator_unavailable", "Account coordination is temporarily unavailable.");
  }
  if (response.status === 409) {
    throw new ApiError(409, "state_conflict", "Your account changed in another request. Refresh and try again.");
  }
  if (response.status === 410) {
    throw new ApiError(410, "account_deleted", "This beta account was deleted. Sign in again only if you want a new demo account.");
  }
  if (response.status === 413) throw new ApiError(413, "state_limit_reached", "This beta account reached its storage limit. Export or delete data before adding more.");
  if (!response.ok) throw new ApiError(503, "persistence_unavailable", "Could not save your changes.");
  return ((await response.json()) as { revision: number }).revision;
}

async function tombstoneCoordinatedState(env: Env, tenantId: string, userId: string): Promise<void> {
  const stub = userStateStub(env, tenantId, userId);
  if (!stub) return;
  let response: Response;
  try {
    response = await stub.fetch("https://user-state.internal/state", { method: "DELETE" });
  } catch {
    throw new ApiError(503, "state_coordinator_unavailable", "Account coordination is temporarily unavailable.");
  }
  if (!response.ok) throw new ApiError(503, "persistence_unavailable", "Could not delete your account state.");
}

function isQuietTime(date: Date, timezone: string, start: string, end: string): boolean {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const hour = Number(parts.find((part) => part.type === "hour")?.value || "0");
    const minute = Number(parts.find((part) => part.type === "minute")?.value || "0");
    const current = hour * 60 + minute;
    const [startHour, startMinute] = start.split(":").map(Number);
    const [endHour, endMinute] = end.split(":").map(Number);
    const startValue = startHour * 60 + startMinute;
    const endValue = endHour * 60 + endMinute;
    if (startValue === endValue) return false;
    return startValue < endValue
      ? current >= startValue && current < endValue
      : current >= startValue || current < endValue;
  } catch {
    return true;
  }
}

async function createSessionState(
  env: Env,
  state: DemoState,
  tokenHash: string,
  sessionId: string,
  expiresAt: number,
): Promise<Actor> {
  if (expiresAt <= Date.now()) {
    throw new ApiError(410, "bootstrap_expired", "This temporary setup token has expired.");
  }
  const key = stateKey(state.tenantId, state.user.id);
  if (env.DB) {
    const statements = [
      env.DB.prepare("INSERT OR IGNORE INTO tenants (id, name, status, created_at) VALUES (?, ?, 'active', ?)").bind(
        state.tenantId,
        "Saathkind",
        state.user.createdAt,
      ),
      env.DB.prepare(
        "INSERT INTO users (id, tenant_id, email, display_name, status, adult_confirmed_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?, ?)",
      ).bind(
        state.user.id,
        state.tenantId,
        state.user.email,
        state.user.displayName,
        state.user.createdAt,
        state.user.createdAt,
        state.user.createdAt,
      ),
      env.DB.prepare(
        "INSERT INTO sessions (id, tenant_id, user_id, token_hash, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).bind(
        sessionId,
        state.tenantId,
        state.user.id,
        tokenHash,
        new Date(expiresAt).toISOString(),
        state.user.createdAt,
        state.user.createdAt,
      ),
      env.DB.prepare(
        "INSERT INTO app_state (tenant_id, user_id, state_json, version, updated_at) VALUES (?, ?, ?, 1, ?)",
      ).bind(state.tenantId, state.user.id, JSON.stringify(state), state.user.createdAt),
      env.DB.prepare(
        `INSERT INTO profiles
          (tenant_id, user_id, timezone, language, pronouns, quiet_start, quiet_end, followups_enabled, memory_paused, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        state.tenantId,
        state.user.id,
        state.profile.timezone,
        state.profile.language,
        state.profile.pronouns,
        state.profile.quietStart,
        state.profile.quietEnd,
        state.profile.followupsEnabled ? 1 : 0,
        state.profile.memoryPaused ? 1 : 0,
        state.user.createdAt,
      ),
    ];
    for (const [purpose, consent] of Object.entries(state.consents)) {
      statements.push(
        env.DB.prepare(
          "INSERT INTO user_consents (tenant_id, user_id, purpose, granted, updated_at) VALUES (?, ?, ?, ?, ?)",
        ).bind(state.tenantId, state.user.id, purpose, consent.granted ? 1 : 0, consent.updatedAt),
      );
    }
    for (const event of state.consentEvents) {
      statements.push(
        env.DB.prepare(
          "INSERT INTO consent_events (id, tenant_id, user_id, purpose, granted, policy_version, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(
          event.id,
          state.tenantId,
          state.user.id,
          event.purpose,
          event.granted ? 1 : 0,
          event.policyVersion,
          event.source,
          event.createdAt,
        ),
      );
    }
    await env.DB.batch(statements);
    return { tenantId: state.tenantId, userId: state.user.id, sessionId, status: "active", mode: "d1", tokenHash };
  }
  if (env.STATE) {
    const stateRevision = env.USER_STATE
      ? await initializeCoordinatedState(env, state, { tokenHash, sessionId, expiresAt })
      : undefined;
    if (!env.USER_STATE) {
      const writes = await Promise.allSettled([
        env.STATE.put(key, JSON.stringify(state)),
        env.STATE.put(
          `session:${tokenHash}`,
          JSON.stringify({ key, sessionId, tenantId: state.tenantId, userId: state.user.id }),
          { expiration: Math.ceil(expiresAt / 1_000) },
        ),
        env.STATE.put(`user-session:${state.tenantId}:${state.user.id}`, tokenHash, { expiration: Math.ceil(expiresAt / 1_000) }),
      ]);
      if (writes.some((result) => result.status === "rejected")) {
        throw new ApiError(503, "persistence_unavailable", "Could not confirm the temporary beta session. Retry with the same setup token.");
      }
    }
    return { tenantId: state.tenantId, userId: state.user.id, sessionId, status: "active", mode: "kv", tokenHash, stateRevision };
  }
  volatileStates.set(key, state);
  volatileSessions.set(tokenHash, `${key}|${sessionId}`);
  return { tenantId: state.tenantId, userId: state.user.id, sessionId, status: "active", mode: "volatile", tokenHash };
}

async function writeCoordinatedSessionRouting(env: Env, actor: Actor, expiresAt: number): Promise<void> {
  if (!env.STATE || actor.mode !== "kv") return;
  const key = stateKey(actor.tenantId, actor.userId);
  const writes = await Promise.allSettled([
    env.STATE.put(
      `session:${actor.tokenHash}`,
      JSON.stringify({ key, sessionId: actor.sessionId, tenantId: actor.tenantId, userId: actor.userId }),
      { expiration: Math.ceil(expiresAt / 1_000) },
    ),
    env.STATE.put(`user-session:${actor.tenantId}:${actor.userId}`, actor.tokenHash, { expiration: Math.ceil(expiresAt / 1_000) }),
  ]);
  if (writes.some((result) => result.status === "rejected")) {
    // The committed token coordinator remains a strongly consistent recovery
    // route even when either eventually-consistent pointer is not confirmed.
    throw new ApiError(503, "persistence_unavailable", "Could not confirm the temporary beta session. Retry with the same setup token.");
  }
}

async function authenticate(request: Request, env: Env): Promise<{ actor: Actor; state: DemoState }> {
  const token = tokenFrom(request);
  if (!token || token.length < 24) throw new ApiError(401, "authentication_required", "Sign in to continue.");
  const tokenHash = await sha256(token);
  if (env.DB) {
    const row = await env.DB.prepare(
      `SELECT s.id AS session_id, s.tenant_id, s.user_id, u.status, a.state_json
       FROM sessions s
       JOIN users u ON u.id = s.user_id AND u.tenant_id = s.tenant_id
       JOIN app_state a ON a.user_id = s.user_id AND a.tenant_id = s.tenant_id
       WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
    )
      .bind(tokenHash, now())
      .first<{ session_id: string; tenant_id: string; user_id: string; status: string; state_json: string }>();
    if (!row) throw new ApiError(401, "invalid_session", "Your session is invalid or expired.");
    const state = JSON.parse(row.state_json) as DemoState;
    return {
      actor: {
        tenantId: row.tenant_id,
        userId: row.user_id,
        sessionId: row.session_id,
        status: row.status,
        mode: "d1",
        tokenHash,
      },
      state,
    };
  }
  if (env.STATE) {
    let pointer = await env.STATE.get<{ key: string; sessionId: string; tenantId?: string; userId?: string }>(`session:${tokenHash}`, "json");
    if (env.USER_STATE && (!pointer?.tenantId || !pointer?.userId)) {
      const route = await readBootstrapRoute(env, tokenHash);
      if (route) {
        pointer = {
          key: stateKey(route.tenantId, route.userId),
          sessionId: route.sessionId,
          tenantId: route.tenantId,
          userId: route.userId,
        };
      }
    }
    if (!pointer) throw new ApiError(401, "invalid_session", "Your session is invalid or expired.");
    let state: DemoState | null = null;
    let stateRevision: number | undefined;
    if (env.USER_STATE) {
      // Coordinator-era sessions can route through the strongly consistent
      // bootstrap claim when KV is stale. Legacy pointers have no such claim
      // and remain deliberately invalidated at this boundary.
      const tenantId = pointer.tenantId;
      const userId = pointer.userId;
      if (!tenantId || !userId) throw new ApiError(401, "invalid_session", "Your beta session expired. Start a new synthetic demo from this device.");
      const coordinated = await readCoordinatedState(env, tenantId, userId);
      if (coordinated === "deleted") throw new ApiError(401, "invalid_session", "Your session is invalid or expired.");
      if (coordinated === "missing" || coordinated === "deleted") throw new ApiError(401, "invalid_session", "Your session is invalid or expired.");
      state = coordinated.state;
      stateRevision = coordinated.revision;
      await validateCoordinatedSession(env, {
        tenantId,
        userId,
        sessionId: pointer.sessionId,
        status: state.user.status,
        mode: "kv",
        tokenHash,
        stateRevision,
      });
    } else {
      state = await env.STATE.get<DemoState>(pointer.key, "json");
    }
    if (!state) throw new ApiError(401, "invalid_session", "Your session is invalid or expired.");
    return {
      actor: {
        tenantId: state.tenantId,
        userId: state.user.id,
        sessionId: pointer.sessionId,
        status: state.user.status,
        mode: "kv",
        tokenHash,
        stateRevision,
      },
      state,
    };
  }
  const pointer = volatileSessions.get(tokenHash);
  if (!pointer) throw new ApiError(401, "invalid_session", "Your session is invalid or expired.");
  const [key, sessionId] = pointer.split("|");
  const state = volatileStates.get(key);
  if (!state) throw new ApiError(401, "invalid_session", "Your session is invalid or expired.");
  return {
    actor: {
      tenantId: state.tenantId,
      userId: state.user.id,
      sessionId,
      status: state.user.status,
      mode: "volatile",
      tokenHash,
    },
    state,
  };
}

async function saveState(env: Env, actor: Actor, state: DemoState): Promise<void> {
  if (actor.mode === "d1" && env.DB) {
    const updatedAt = now();
    const statements = [
      env.DB.prepare(
        "UPDATE app_state SET state_json = ?, version = version + 1, updated_at = ? WHERE tenant_id = ? AND user_id = ?",
      ).bind(JSON.stringify(state), updatedAt, actor.tenantId, actor.userId),
      env.DB.prepare(
        "UPDATE users SET display_name = ?, status = ?, updated_at = ? WHERE tenant_id = ? AND id = ?",
      ).bind(state.user.displayName, state.user.status, updatedAt, actor.tenantId, actor.userId),
      env.DB.prepare(
        `INSERT INTO profiles
          (tenant_id, user_id, timezone, language, pronouns, quiet_start, quiet_end, followups_enabled, memory_paused, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(tenant_id, user_id) DO UPDATE SET
           timezone=excluded.timezone, language=excluded.language, pronouns=excluded.pronouns,
           quiet_start=excluded.quiet_start, quiet_end=excluded.quiet_end,
           followups_enabled=excluded.followups_enabled, memory_paused=excluded.memory_paused,
           updated_at=excluded.updated_at`,
      ).bind(
        actor.tenantId,
        actor.userId,
        state.profile.timezone,
        state.profile.language,
        state.profile.pronouns,
        state.profile.quietStart,
        state.profile.quietEnd,
        state.profile.followupsEnabled ? 1 : 0,
        state.profile.memoryPaused ? 1 : 0,
        updatedAt,
      ),
    ];
    for (const [purpose, consent] of Object.entries(state.consents)) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO user_consents (tenant_id, user_id, purpose, granted, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(tenant_id, user_id, purpose) DO UPDATE SET granted=excluded.granted, updated_at=excluded.updated_at`,
        ).bind(actor.tenantId, actor.userId, purpose, consent.granted ? 1 : 0, consent.updatedAt),
      );
    }
    for (const event of state.consentEvents || []) {
      statements.push(
        env.DB.prepare(
          "INSERT OR IGNORE INTO consent_events (id, tenant_id, user_id, purpose, granted, policy_version, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(
          event.id,
          actor.tenantId,
          actor.userId,
          event.purpose,
          event.granted ? 1 : 0,
          event.policyVersion,
          event.source,
          event.createdAt,
        ),
      );
    }
    const results = await env.DB.batch(statements);
    if (results.some((result) => !result.success)) throw new ApiError(503, "persistence_unavailable", "Could not save your changes.");
    return;
  }
  if (actor.mode === "kv" && env.STATE) {
    if (env.USER_STATE) {
      actor.stateRevision = await commitCoordinatedState(env, actor, state);
    } else {
      await env.STATE.put(stateKey(actor.tenantId, actor.userId), JSON.stringify(state));
    }
    return;
  }
  volatileStates.set(stateKey(actor.tenantId, actor.userId), state);
}

async function revokeSession(env: Env, actor: Actor): Promise<void> {
  if (actor.mode === "d1" && env.DB) {
    await env.DB.prepare(
      "UPDATE sessions SET revoked_at = ? WHERE id = ? AND tenant_id = ? AND user_id = ?",
    )
      .bind(now(), actor.sessionId, actor.tenantId, actor.userId)
      .run();
  } else if (actor.mode === "kv" && env.STATE) {
    if (env.USER_STATE) await revokeCoordinatedSession(env, actor);
    await env.STATE.delete(`session:${actor.tokenHash}`);
  } else {
    volatileSessions.delete(actor.tokenHash);
  }
}

async function enforceRate(env: Env, key: string, limit: number, seconds: number, subject?: string): Promise<void> {
  if (env.USER_STATE) {
    try {
      const stub = env.USER_STATE.get(env.USER_STATE.idFromName(`__rate__:${key}`));
      const response = await stub.fetch("https://user-state.internal/rate-limit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit, seconds, ...(subject ? { subject } : {}) }),
      });
      if (response.status === 429) {
        throw new ApiError(429, "rate_limit_exceeded", "Too many requests. Please wait and try again.", {
          retryAfterSeconds: seconds,
        });
      }
      if (!response.ok) throw new Error(`rate coordinator returned ${response.status}`);
      return;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (env.ENVIRONMENT === "production") {
        throw new ApiError(503, "rate_limit_unavailable", "Request protection is temporarily unavailable. Please try again.");
      }
    }
  } else if (env.ENVIRONMENT === "production") {
    throw new ApiError(503, "rate_limit_unavailable", "Request protection is temporarily unavailable. Please try again.");
  }
  const bucket = Math.floor(Date.now() / (seconds * 1000));
  const storageKey = `rate:${key}:${bucket}`;
  let hits = 1;
  if (env.RATE_LIMIT) {
    hits = Number((await env.RATE_LIMIT.get(storageKey)) || "0") + 1;
    await env.RATE_LIMIT.put(storageKey, String(hits), { expirationTtl: Math.max(60, seconds * 2) });
  } else {
    const current = volatileRates.get(storageKey);
    hits = current && current.expiresAt > Date.now() ? current.hits + 1 : 1;
    volatileRates.set(storageKey, { hits, expiresAt: Date.now() + seconds * 1000 });
  }
  if (hits > limit) {
    throw new ApiError(429, "rate_limit_exceeded", "Too many requests. Please wait and try again.", {
      retryAfterSeconds: seconds,
    });
  }
}

type BootstrapIdentity = {
  tenantId: string;
  userId: string;
  sessionId: string;
  accountCreatedAt: string;
};

type BootstrapClaimResult = {
  owner: boolean;
  status: "pending" | "committed";
  expiresAt: number;
  identity: BootstrapIdentity;
};

async function claimBootstrapToken(
  env: Env,
  tokenHash: string,
  fingerprint: string,
  identity: BootstrapIdentity,
): Promise<BootstrapClaimResult> {
  if (!env.USER_STATE) {
    if (env.ENVIRONMENT === "production") {
      throw new ApiError(503, "state_coordinator_unavailable", "Account coordination is temporarily unavailable.");
    }
    return { owner: true, status: "pending", expiresAt: Date.parse(identity.accountCreatedAt) + SESSION_TTL_SECONDS * 1_000, identity };
  }
  try {
    const stub = env.USER_STATE.get(env.USER_STATE.idFromName(`__bootstrap__:${tokenHash}`));
    const response = await stub.fetch("https://user-state.internal/bootstrap-claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fingerprint, expiresAt: Date.parse(identity.accountCreatedAt) + SESSION_TTL_SECONDS * 1_000, identity }),
    });
    if (response.status === 409) {
      const conflict = (await response.json().catch(() => ({}))) as { code?: string };
      if (conflict.code === "bootstrap_token_deleted") {
        throw new ApiError(409, "bootstrap_token_deleted", "This temporary setup token belongs to a deleted beta account and cannot be reused.");
      }
      throw new ApiError(409, "bootstrap_token_conflict", "This temporary setup token was already used for different choices.");
    }
    if (!response.ok) throw new Error(`bootstrap coordinator returned ${response.status}`);
    const result = (await response.json()) as Partial<BootstrapClaimResult>;
    if (
      typeof result.owner !== "boolean"
      || !["pending", "committed"].includes(String(result.status))
      || !Number.isFinite(result.expiresAt)
      || Number(result.expiresAt) <= Date.now()
      || !result.identity?.tenantId
      || !result.identity.userId
      || !result.identity.sessionId
      || !Number.isFinite(Date.parse(result.identity.accountCreatedAt))
    ) throw new Error("bootstrap coordinator returned an invalid claim");
    return result as BootstrapClaimResult;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, "state_coordinator_unavailable", "Account coordination is temporarily unavailable.");
  }
}

async function commitBootstrapToken(env: Env, tokenHash: string, fingerprint: string, expiresAt: number): Promise<void> {
  if (!env.USER_STATE) return;
  try {
    const stub = env.USER_STATE.get(env.USER_STATE.idFromName(`__bootstrap__:${tokenHash}`));
    const response = await stub.fetch("https://user-state.internal/bootstrap-commit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fingerprint, expiresAt }),
    });
    if (!response.ok) throw new Error(`bootstrap commit returned ${response.status}`);
  } catch {
    throw new ApiError(503, "state_coordinator_unavailable", "Account coordination is temporarily unavailable.");
  }
}

type DeletionReceipt = { id: string; status: "deleted"; completedAt: string };
type BootstrapDeletionStatus = {
  status: "deleting" | "deleted";
  expiresAt: number;
  receipt: DeletionReceipt;
  identity?: BootstrapIdentity;
};

async function bootstrapDeletionRequest(
  env: Env,
  tokenHash: string,
  path: "/bootstrap-delete/start" | "/bootstrap-delete/finish",
  receipt: DeletionReceipt,
): Promise<BootstrapDeletionStatus> {
  if (!env.USER_STATE) throw new ApiError(503, "state_coordinator_unavailable", "Deletion coordination is unavailable.");
  try {
    const stub = env.USER_STATE.get(env.USER_STATE.idFromName(`__bootstrap__:${tokenHash}`));
    const response = await stub.fetch(`https://user-state.internal${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expiresAt: Date.now() + SESSION_TTL_SECONDS * 1_000, receipt }),
    });
    if (!response.ok) throw new Error(`bootstrap deletion returned ${response.status}`);
    return await response.json() as BootstrapDeletionStatus;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, "deletion_coordination_unavailable", "Account deletion could not be safely coordinated. Retry with the same token.");
  }
}

async function readBootstrapDeletion(env: Env, tokenHash: string): Promise<BootstrapDeletionStatus | null> {
  if (!env.USER_STATE) return null;
  try {
    const stub = env.USER_STATE.get(env.USER_STATE.idFromName(`__bootstrap__:${tokenHash}`));
    const response = await stub.fetch("https://user-state.internal/bootstrap-delete/status");
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`bootstrap deletion status returned ${response.status}`);
    return await response.json() as BootstrapDeletionStatus;
  } catch {
    throw new ApiError(503, "deletion_coordination_unavailable", "Account deletion status could not be verified. Retry shortly.");
  }
}

async function readBootstrapRoute(env: Env, tokenHash: string): Promise<BootstrapIdentity | null> {
  if (!env.USER_STATE) return null;
  try {
    const stub = env.USER_STATE.get(env.USER_STATE.idFromName(`__bootstrap__:${tokenHash}`));
    const response = await stub.fetch("https://user-state.internal/bootstrap-route");
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`bootstrap route returned ${response.status}`);
    const result = await response.json() as { identity?: BootstrapIdentity };
    return result.identity || null;
  } catch {
    throw new ApiError(503, "state_coordinator_unavailable", "Session routing is temporarily unavailable.");
  }
}

async function cleanupDeletionRouting(env: Env, tokenHash: string, tenantId: string, userId: string): Promise<boolean> {
  if (!env.STATE) return true;
  const cleanup = await Promise.allSettled([
    env.STATE.delete(`session:${tokenHash}`),
    env.STATE.delete(`user-session:${tenantId}:${userId}`),
  ]);
  return cleanup.every((result) => result.status === "fulfilled");
}

async function requireAdmin(request: Request, env: Env): Promise<void> {
  if (!env.ADMIN_API_KEY) throw new ApiError(503, "admin_not_configured", "Admin access is not configured.");
  const supplied = tokenFrom(request) || "";
  const [actual, expected] = await Promise.all([sha256(supplied), sha256(env.ADMIN_API_KEY)]);
  let different = actual.length ^ expected.length;
  for (let index = 0; index < Math.min(actual.length, expected.length); index += 1) {
    different |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  if (different !== 0) throw new ApiError(401, "admin_authentication_required", "Admin credentials are invalid.");
}

function sessionView(state: DemoState, actor: Actor, env?: Env) {
  return {
    authenticated: true,
    storageMode: actor.mode,
    user: state.user,
    profile: state.profile,
    consents: state.consents,
    capabilities: {
      gemini: Boolean(env?.GEMINI_API_KEY && env.ENABLE_GEMINI === "true"),
      durableDatabase: actor.mode === "d1",
      proactiveDelivery: false,
    },
  };
}

function exportSnapshot(state: DemoState) {
  return {
    exportedAt: now(),
    user: state.user,
    profile: state.profile,
    consents: state.consents,
    consentEvents: state.consentEvents || [],
    conversations: state.conversations,
    messages: state.messages,
    memories: state.memories,
    followups: state.followups,
    goals: state.goals,
    usage: state.usage,
    usagePeriod: state.usagePeriod || null,
    dataRequests: state.dataRequests.map((request) => ({
      id: request.id,
      type: request.type,
      status: request.status,
      createdAt: request.createdAt,
      completedAt: request.completedAt || null,
    })),
  };
}

async function bootstrap(request: Request, env: Env, requestId: string): Promise<Response> {
  if (env.ALLOW_DEMO_AUTH === "false") throw new ApiError(404, "not_found", "Route not found.");
  const ipHash = await sha256(request.headers.get("cf-connecting-ip") || "local");
  await enforceRate(env, `bootstrap:${ipHash}`, 10, 3600);
  const body = await readJson(request);
  if (body.ageConfirmed !== true) {
    throw new ApiError(422, "adult_confirmation_required", "Saathkind is available only to adults aged 18 or older.");
  }
  const consents = (body.consents || {}) as Record<string, unknown>;
  if (consents.chatStorage !== true || consents.aiProcessing !== true) {
    throw new ApiError(422, "required_consent_missing", "Chat storage and AI processing consent are required.");
  }
  const displayName = text(body.displayName, 80, "Friend");
  const timezone = text(body.timezone, 80, "Asia/Kolkata");
  if (!isTimezone(timezone)) throw new ApiError(422, "invalid_timezone", "Choose a valid IANA timezone.");
  const requestedLanguage = text(body.language, 20, "hinglish");
  const language = (["en", "hi", "hinglish"].includes(requestedLanguage) ? requestedLanguage : "hinglish") as
    | "en"
    | "hi"
    | "hinglish";
  const proposedIdentity: BootstrapIdentity = {
    tenantId: text(env.DEFAULT_TENANT_ID, 80, "saathkind"),
    userId: id("usr"),
    sessionId: id("ses"),
    accountCreatedAt: now(),
  };
  const requestedAccessToken = text(body.clientAccessToken, 128);
  const accessToken = /^[a-f0-9]{64,128}$/i.test(requestedAccessToken)
    ? requestedAccessToken
    : `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
  const tokenHash = await sha256(accessToken);
  // Admit at most 400 distinct validated setup tokens per fixed day. Replays
  // of the same recovery token do not consume another slot, while the bounded
  // subject set prevents a single account from exhausting routing KV writes.
  await enforceRate(env, "bootstrap:global-day", 400, 86_400, tokenHash);
  const bootstrapFingerprint = await sha256(JSON.stringify({
    displayName,
    timezone,
    language,
    pronouns: text(body.pronouns, 40) || null,
    consents: Object.fromEntries(["chatStorage", "aiProcessing", "memory", "proactiveFollowups", "moodInference"].map((name) => [name, consents[name] === true])),
  }));
  const bootstrapClaim = await claimBootstrapToken(env, tokenHash, bootstrapFingerprint, proposedIdentity);
  const { tenantId, userId, sessionId, accountCreatedAt: createdAt } = bootstrapClaim.identity;
  const bootstrapExpiresAt = bootstrapClaim.expiresAt;
  const cookieMaxAge = Math.max(1, Math.ceil((bootstrapExpiresAt - Date.now()) / 1_000));
  if (!bootstrapClaim.owner) {
    if (bootstrapClaim.status !== "committed") {
      throw new ApiError(409, "bootstrap_in_progress", "This temporary setup is still being created. Wait a moment and retry with the same token.");
    }
    try {
      const { actor, state: existingState } = await authenticate(new Request(request.url, {
        headers: { authorization: `Bearer ${accessToken}` },
      }), env);
      return json(
        { ...sessionView(existingState, actor, env), accessToken, notice: "Recovered the existing temporary beta setup." },
        requestId,
        200,
        { "set-cookie": `${SESSION_COOKIE}=${encodeURIComponent(accessToken)}; Path=/; Max-Age=${cookieMaxAge}; HttpOnly; Secure; SameSite=Lax` },
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        throw new ApiError(409, "bootstrap_in_progress", "This temporary setup is still being created. Wait a moment and retry with the same token.");
      }
      throw error;
    }
  }
  const consentNames = ["chatStorage", "aiProcessing", "memory", "proactiveFollowups", "moodInference"];
  const state: DemoState = {
    version: 1,
    tenantId,
    user: {
      id: userId,
      // The synthetic beta deliberately does not collect or persist email,
      // including from direct API callers.
      email: null,
      displayName,
      status: "active",
      createdAt,
    },
    profile: {
      timezone,
      language,
      pronouns: text(body.pronouns, 40) || null,
      quietStart: "22:00",
      quietEnd: "08:00",
      followupsEnabled: consents.proactiveFollowups === true,
      memoryPaused: consents.memory !== true,
    },
    consents: Object.fromEntries(
      consentNames.map((name) => [name, { granted: consents[name] === true, updatedAt: createdAt }]),
    ),
    consentEvents: consentNames.map((purpose) => ({
      id: id("cns"),
      purpose,
      granted: consents[purpose] === true,
      policyVersion: "2026-08-18",
      source: "demo_bootstrap",
      createdAt,
    })),
    conversations: [],
    messages: [],
    memories: [],
    followups: [],
    goals: [],
    dataRequests: [],
    usage: {},
    usagePeriod: BETA_USAGE_PERIOD,
    idempotency: {},
  };
  const actor = await createSessionState(env, state, tokenHash, sessionId, bootstrapExpiresAt);
  // Publish the strongly consistent claim before eventually-consistent KV
  // routing. A failed claim commit cannot be mistaken for a recovered session;
  // a failed pointer write remains recoverable through the committed claim.
  await commitBootstrapToken(env, tokenHash, bootstrapFingerprint, bootstrapExpiresAt);
  if (env.USER_STATE) await writeCoordinatedSessionRouting(env, actor, bootstrapExpiresAt);
  const headers = new Headers({
    "set-cookie": `${SESSION_COOKIE}=${encodeURIComponent(accessToken)}; Path=/; Max-Age=${cookieMaxAge}; HttpOnly; Secure; SameSite=Lax`,
  });
  return json(
    { ...sessionView(state, actor, env), accessToken, notice: "Demo authentication is not a verified production identity." },
    requestId,
    201,
    headers,
  );
}

function paginate<T extends Record<string, unknown>>(items: T[], url: URL): { items: T[]; nextCursor: string | null } {
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 30, 1), 100);
  const cursor = url.searchParams.get("cursor");
  const start = cursor ? Math.max(items.findIndex((item) => item.id === cursor) + 1, 0) : 0;
  const page = items.slice(start, start + limit);
  return { items: page, nextCursor: start + limit < items.length ? String(page.at(-1)?.id || "") : null };
}

function findOwned(items: Array<Record<string, unknown>>, itemId: string, name: string): Record<string, unknown> {
  const item = items.find((candidate) => candidate.id === itemId);
  if (!item) throw new ApiError(404, `${name}_not_found`, `${name[0].toUpperCase()}${name.slice(1)} not found.`);
  return item;
}

async function routeAuthed(ctx: RequestContext): Promise<Response> {
  const { request, env, actor, state, requestId, path, segments, url } = ctx;
  const method = request.method;
  if (state.user.status === "deletion_pending" && !path.startsWith("/data/delete") && path !== "/session") {
    throw new ApiError(423, "account_pending_deletion", "This account is pending deletion.");
  }

  if (path === "/session" && method === "GET") {
    return json(sessionView(state, actor, env), requestId);
  }
  if ((path === "/session" && method === "DELETE") || (path === "/auth/logout" && method === "POST")) {
    await revokeSession(env, actor);
    return json({ signedOut: true }, requestId, 200, {
      "set-cookie": `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
    });
  }

  if (path === "/profile" && method === "GET") return json(state.profile, requestId);
  if (path === "/profile" && method === "PATCH") {
    const body = await readJson(request);
    if (body.displayName !== undefined) {
      const displayName = text(body.displayName, 80);
      if (!displayName) throw new ApiError(422, "invalid_display_name", "Display name cannot be empty.");
      state.user.displayName = displayName;
    }
    if (body.timezone !== undefined) {
      const timezone = text(body.timezone, 80);
      if (!isTimezone(timezone)) throw new ApiError(422, "invalid_timezone", "Choose a valid IANA timezone.");
      state.profile.timezone = timezone;
    }
    if (body.language !== undefined) {
      const language = text(body.language, 20);
      if (!["en", "hi", "hinglish"].includes(language)) throw new ApiError(422, "invalid_language", "Language is invalid.");
      state.profile.language = language as "en" | "hi" | "hinglish";
    }
    if (body.pronouns !== undefined) state.profile.pronouns = text(body.pronouns, 40) || null;
    if (body.memoryPaused !== undefined) {
      const memoryPaused = bool(body.memoryPaused);
      if (!memoryPaused && state.consents.memory?.granted !== true) {
        throw new ApiError(409, "memory_consent_required", "Grant memory consent before resuming memory use.");
      }
      state.profile.memoryPaused = memoryPaused;
    }
    await saveState(env, actor, state);
    return json({ user: state.user, profile: state.profile }, requestId);
  }

  if (path === "/consents" && method === "GET") return json(state.consents, requestId);
  if (path === "/consents" && method === "PATCH") {
    const body = await readJson(request);
    const allowed = ["chatStorage", "aiProcessing", "memory", "proactiveFollowups", "moodInference"];
    let changed = false;
    state.consentEvents ||= [];
    for (const name of allowed) {
      if (typeof body[name] === "boolean") {
        state.consents[name] = { granted: body[name] as boolean, updatedAt: now() };
        state.consentEvents.push({
          id: id("cns"),
          purpose: name,
          granted: body[name] as boolean,
          policyVersion: "2026-08-18",
          source: "settings",
          createdAt: now(),
        });
        changed = true;
      }
    }
    if (!changed) throw new ApiError(422, "no_consent_changes", "Provide at least one consent setting.");
    state.consentEvents = state.consentEvents.slice(-BETA_RESOURCE_LIMITS.consentEvents);
    state.profile.memoryPaused = !state.consents.memory?.granted;
    state.profile.followupsEnabled = !!state.consents.proactiveFollowups?.granted;
    await saveState(env, actor, state);
    return json(state.consents, requestId);
  }

  if (path === "/quiet-hours" && method === "GET") {
    return json(
      { start: state.profile.quietStart, end: state.profile.quietEnd, timezone: state.profile.timezone, enabled: state.profile.followupsEnabled },
      requestId,
    );
  }
  if (path === "/quiet-hours" && method === "PATCH") {
    if (!state.consents.proactiveFollowups?.granted) {
      throw new ApiError(403, "followups_disabled", "Re-enable follow-up planning before changing planner boundaries.");
    }
    const body = await readJson(request);
    const start = text(body.start, 5, state.profile.quietStart);
    const end = text(body.end, 5, state.profile.quietEnd);
    if (!validateClock(start) || !validateClock(end)) throw new ApiError(422, "invalid_quiet_hours", "Use 24-hour HH:MM values.");
    state.profile.quietStart = start;
    state.profile.quietEnd = end;
    if (typeof body.enabled === "boolean") state.profile.followupsEnabled = body.enabled;
    await saveState(env, actor, state);
    return json({ start, end, timezone: state.profile.timezone, enabled: state.profile.followupsEnabled }, requestId);
  }

  if (path === "/conversations" && method === "GET") {
    return json(paginate([...state.conversations].reverse(), url), requestId);
  }
  if (path === "/conversations" && method === "POST") {
    if (state.conversations.length >= BETA_RESOURCE_LIMITS.conversations) {
      throw new ApiError(429, "resource_limit_reached", "This beta account cannot store another conversation.");
    }
    const body = await readJson(request);
    const createdAt = now();
    const conversation = {
      id: id("cnv"),
      title: text(body.title, 120, "New conversation"),
      companion: ["saathi", "tara"].includes(text(body.companion, 20)) ? text(body.companion, 20) : "saathi",
      createdAt,
      updatedAt: createdAt,
    };
    state.conversations.push(conversation);
    await saveState(env, actor, state);
    return json(conversation, requestId, 201);
  }
  if (segments[0] === "conversations" && segments[2] === "messages" && method === "GET") {
    findOwned(state.conversations, segments[1], "conversation");
    const messages = state.messages.filter((message) => message.conversationId === segments[1]);
    return json(paginate(messages, url), requestId);
  }
  if ((segments[0] === "conversations" && segments[2] === "messages" && method === "POST") || (path === "/chat" && method === "POST")) {
    if (!state.consents.chatStorage?.granted || !state.consents.aiProcessing?.granted) {
      throw new ApiError(403, "consent_required", "Chat storage and AI processing consent are required.");
    }
    const body = await readJson(request);
    const content = text(body.content ?? body.message, 2_000);
    if (!content) throw new ApiError(422, "message_required", "Message cannot be empty.");
    const clientMessageId = text(body.clientMessageId, 128) || request.headers.get("idempotency-key") || id("client");
    const prior = state.messages.find((message) => message.clientMessageId === clientMessageId);
    if (prior) {
      if (String(prior.content) !== content) {
        throw new ApiError(409, "duplicate_message_conflict", "This client message ID was already used for different content.");
      }
      const conversation = findOwned(state.conversations, String(prior.conversationId), "conversation");
      const assistant = state.messages.find((message) => message.replyTo === prior.id);
      return json({
        conversation,
        userMessage: prior,
        assistantMessage: assistant,
        duplicate: true,
        fallback: assistant?.provider !== "gemini",
        usage: {
          period: state.usagePeriod,
          counters: { messages: state.usage.messages || 0 },
          limits: { messages: BETA_LIFETIME_MESSAGE_LIMIT },
          remaining: { messages: Math.max(BETA_LIFETIME_MESSAGE_LIMIT - (state.usage.messages || 0), 0) },
        },
      }, requestId, 201);
    }
    rollUsagePeriod(state);
    if ((state.usage.messages || 0) >= BETA_LIFETIME_MESSAGE_LIMIT) {
      throw new ApiError(429, "message_allowance_reached", "This synthetic beta account has reached its lifetime message allowance.", {
        limit: BETA_LIFETIME_MESSAGE_LIMIT,
        messages: state.usage.messages || 0,
        period: state.usagePeriod,
      });
    }
    await enforceRate(env, `chat:${actor.tenantId}:${actor.userId}`, 24, 60);
    let conversationId = path === "/chat" ? text(body.conversationId, 80) : segments[1];
    if (!conversationId) {
      if (state.conversations.length >= BETA_RESOURCE_LIMITS.conversations) {
        throw new ApiError(429, "resource_limit_reached", "This beta account cannot store another conversation.");
      }
      const conversation = { id: id("cnv"), title: content.slice(0, 60), companion: "saathi", createdAt: now(), updatedAt: now() };
      state.conversations.push(conversation);
      conversationId = String(conversation.id);
    }
    const conversation = findOwned(state.conversations, conversationId, "conversation");
    const assessment = assessSafety(content);
    const userMessage = {
      id: id("msg"),
      conversationId,
      role: "user",
      content,
      clientMessageId,
      safetyLevel: assessment.level,
      createdAt: now(),
    };
    state.messages.push(userMessage);
    const history = state.messages
      .filter((message) => message.conversationId === conversationId && message.id !== userMessage.id)
      .slice(-16)
      .map((message) => ({ role: message.role as "user" | "assistant", content: String(message.content) }));
    const approvedMemories = state.profile.memoryPaused || state.consents.memory?.granted !== true
      ? []
      : state.memories
          .filter((memory) => memory.status === "active")
          .sort((a, b) => Number(b.pinned) - Number(a.pinned))
          .slice(0, 12)
          .map((memory) => String(memory.content));
    const generated = assessment.shouldCallModel
      ? await generateReply({
          env,
          input: content,
          displayName: state.user.displayName,
          language: state.profile.language,
          history,
          memories: approvedMemories,
          safety: assessment,
        })
      : { text: assessment.response || "Please contact emergency support now.", provider: "demo" as const, model: "safety-router-v1" };
    const assistantMessage = {
      id: id("msg"),
      conversationId,
      role: "assistant",
      content: generated.text,
      replyTo: userMessage.id,
      provider: generated.provider,
      model: generated.model,
      safetyLevel: assessment.level,
      createdAt: now(),
    };
    state.messages.push(assistantMessage);
    conversation.updatedAt = now();
    state.usage.messages = (state.usage.messages || 0) + 1;
    state.usage.modelCalls = (state.usage.modelCalls || 0) + (generated.provider === "gemini" ? 1 : 0);
    await saveState(env, actor, state);
    return json(
      {
        conversation,
        userMessage,
        assistantMessage,
        safety: { level: assessment.level, category: assessment.category, resources: assessment.resources || [] },
        fallback: generated.provider === "demo",
        usage: {
          period: state.usagePeriod,
          counters: { messages: state.usage.messages || 0 },
          limits: { messages: BETA_LIFETIME_MESSAGE_LIMIT },
          remaining: { messages: Math.max(BETA_LIFETIME_MESSAGE_LIMIT - (state.usage.messages || 0), 0) },
        },
      },
      requestId,
      201,
    );
  }

  if (path === "/memories" && method === "GET") {
    const status = url.searchParams.get("status") || "active";
    return json(paginate(state.memories.filter((memory) => memory.status === status).reverse(), url), requestId);
  }
  if (path === "/memories" && method === "POST") {
    if (!state.consents.memory?.granted || state.profile.memoryPaused) throw new ApiError(403, "memory_disabled", "Enable memory first.");
    if (state.memories.length >= BETA_RESOURCE_LIMITS.memories) {
      throw new ApiError(429, "resource_limit_reached", "This beta account can store up to 100 memories. Delete one before adding another.");
    }
    const body = await readJson(request);
    const content = text(body.content, 1_000);
    if (!content) throw new ApiError(422, "memory_required", "Memory content cannot be empty.");
    const sourceMessageId = text(body.sourceMessageId, 80) || null;
    if (sourceMessageId) {
      const source = findOwned(state.messages, sourceMessageId, "source message");
      if (source.role !== "user") throw new ApiError(422, "invalid_memory_source", "A conversation memory must reference your message.");
    }
    const memory = {
      id: id("mem"),
      content,
      category: text(body.category, 40, "fact"),
      pinned: bool(body.pinned),
      confidence: Math.min(Math.max(Number(body.confidence) || 1, 0), 1),
      sourceMessageId,
      status: "active",
      createdAt: now(),
      updatedAt: now(),
    };
    state.memories.push(memory);
    await saveState(env, actor, state);
    return json(memory, requestId, 201);
  }
  if (segments[0] === "memories" && segments.length === 2 && method === "PATCH") {
    const memory = findOwned(state.memories, segments[1], "memory");
    const body = await readJson(request);
    if (body.content !== undefined) {
      const content = text(body.content, 1_000);
      if (!content) throw new ApiError(422, "memory_required", "Memory content cannot be empty.");
      memory.content = content;
    }
    if (body.category !== undefined) memory.category = text(body.category, 40, "fact");
    if (typeof body.pinned === "boolean") memory.pinned = body.pinned;
    memory.updatedAt = now();
    await saveState(env, actor, state);
    return json(memory, requestId);
  }
  if (segments[0] === "memories" && segments[2] === "pin" && method === "POST") {
    const memory = findOwned(state.memories, segments[1], "memory");
    const body = await readJson(request);
    memory.pinned = body.pinned !== false;
    memory.updatedAt = now();
    await saveState(env, actor, state);
    return json(memory, requestId);
  }
  if (segments[0] === "memories" && segments.length === 2 && method === "DELETE") {
    const memoryIndex = state.memories.findIndex((memory) => memory.id === segments[1]);
    if (memoryIndex < 0) throw new ApiError(404, "memory_not_found", "Memory not found.");
    state.memories.splice(memoryIndex, 1);
    await saveState(env, actor, state);
    if (env.MEMORY_INDEX) {
      try {
        await env.MEMORY_INDEX.deleteByIds([segments[1]]);
      } catch (error) {
        console.warn(JSON.stringify({ event: "vector_delete_failed", memoryId: segments[1], error: String(error) }));
      }
    }
    return noContent(requestId);
  }

  if (path === "/followups" && method === "GET") return json(paginate([...state.followups].reverse(), url), requestId);
  if (path === "/followups" && method === "POST") {
    if (!state.profile.followupsEnabled || !state.consents.proactiveFollowups?.granted) {
      throw new ApiError(403, "followups_disabled", "Enable proactive follow-ups first.");
    }
    if (state.followups.length >= BETA_RESOURCE_LIMITS.followups) {
      throw new ApiError(429, "resource_limit_reached", "This beta account can store up to 100 planner items. Delete one before adding another.");
    }
    const body = await readJson(request);
    const scheduledFor = new Date(String(body.scheduledFor || ""));
    if (!Number.isFinite(scheduledFor.getTime()) || scheduledFor.getTime() < Date.now()) {
      throw new ApiError(422, "invalid_schedule", "Choose a future follow-up time.");
    }
    const topic = text(body.topic, 240);
    if (!topic) throw new ApiError(422, "topic_required", "Follow-up topic cannot be empty.");
    const followup = {
      id: id("fup"),
      topic,
      message: text(body.message, 500) || null,
      scheduledFor: scheduledFor.toISOString(),
      status: "scheduled",
      createdAt: now(),
      updatedAt: now(),
    };
    state.followups.push(followup);
    await saveState(env, actor, state);
    return json(followup, requestId, 201);
  }
  if (segments[0] === "followups" && segments.length === 2 && method === "PATCH") {
    if (!state.profile.followupsEnabled || !state.consents.proactiveFollowups?.granted) {
      throw new ApiError(403, "followups_disabled", "Re-enable follow-up planning before changing a planner item. Deletion remains available.");
    }
    const followup = findOwned(state.followups, segments[1], "followup");
    const body = await readJson(request);
    if (body.topic !== undefined) followup.topic = text(body.topic, 240);
    if (body.message !== undefined) followup.message = text(body.message, 500) || null;
    if (body.scheduledFor !== undefined) {
      const date = new Date(String(body.scheduledFor));
      if (!Number.isFinite(date.getTime())) throw new ApiError(422, "invalid_schedule", "Follow-up time is invalid.");
      followup.scheduledFor = date.toISOString();
    }
    if (body.status !== undefined && ["scheduled", "snoozed", "cancelled"].includes(String(body.status))) {
      followup.status = String(body.status);
    }
    followup.updatedAt = now();
    await saveState(env, actor, state);
    return json(followup, requestId);
  }
  if (segments[0] === "followups" && segments.length === 2 && method === "DELETE") {
    const followupIndex = state.followups.findIndex((followup) => followup.id === segments[1]);
    if (followupIndex < 0) throw new ApiError(404, "followup_not_found", "Follow-up not found.");
    state.followups.splice(followupIndex, 1);
    await saveState(env, actor, state);
    return noContent(requestId);
  }

  if (path === "/goals" && method === "GET") return json(paginate([...state.goals].reverse(), url), requestId);
  if (path === "/goals" && method === "POST") {
    if (state.goals.length >= BETA_RESOURCE_LIMITS.goals) {
      throw new ApiError(429, "resource_limit_reached", "This beta account can store up to 100 goals. Delete one before adding another.");
    }
    const body = await readJson(request);
    const title = text(body.title, 160);
    if (!title) throw new ApiError(422, "goal_title_required", "Goal title cannot be empty.");
    const total = Math.min(Math.max(Math.round(Number(body.total) || 1), 1), 100);
    const progress = Math.min(Math.max(Math.round(Number(body.progress) || 0), 0), total);
    const goal = {
      id: id("gol"),
      title,
      description: text(body.description, 1_000) || null,
      status: progress >= total ? "completed" : "active",
      progress,
      total,
      targetDate: body.targetDate ? new Date(String(body.targetDate)).toISOString() : null,
      createdAt: now(),
      updatedAt: now(),
    };
    state.goals.push(goal);
    await saveState(env, actor, state);
    return json(goal, requestId, 201);
  }
  if (segments[0] === "goals" && segments.length === 2 && method === "PATCH") {
    const goal = findOwned(state.goals, segments[1], "goal");
    const body = await readJson(request);
    if (body.title !== undefined) goal.title = text(body.title, 160);
    if (body.description !== undefined) goal.description = text(body.description, 1_000) || null;
    if (body.status !== undefined && ["active", "paused", "completed", "abandoned"].includes(String(body.status))) {
      goal.status = String(body.status);
    }
    if (body.total !== undefined) goal.total = Math.min(Math.max(Math.round(Number(body.total) || 1), 1), 100);
    if (body.progress !== undefined) goal.progress = Math.min(Math.max(Math.round(Number(body.progress) || 0), 0), Number(goal.total) || 1);
    if (Number(goal.progress) >= Number(goal.total) && goal.status === "active") goal.status = "completed";
    goal.updatedAt = now();
    await saveState(env, actor, state);
    return json(goal, requestId);
  }
  if (segments[0] === "goals" && segments.length === 2 && method === "DELETE") {
    const index = state.goals.findIndex((goal) => goal.id === segments[1]);
    if (index < 0) throw new ApiError(404, "goal_not_found", "Goal not found.");
    state.goals.splice(index, 1);
    await saveState(env, actor, state);
    return noContent(requestId);
  }

  if (path === "/usage" && method === "GET") {
    if (rollUsagePeriod(state)) await saveState(env, actor, state);
    return json(
      { period: state.usagePeriod, plan: "free", counters: state.usage, limits: { messages: BETA_LIFETIME_MESSAGE_LIMIT }, remaining: { messages: Math.max(BETA_LIFETIME_MESSAGE_LIMIT - (state.usage.messages || 0), 0) } },
      requestId,
    );
  }

  if (path === "/data/export" && method === "POST") {
    return json(
      { id: id("exp"), status: "ready", completedAt: now(), export: exportSnapshot(state) },
      requestId,
      200,
    );
  }
  if (segments[0] === "data" && segments[1] === "export" && segments[2] && method === "GET") {
    const requestRecord = findOwned(state.dataRequests, segments[2], "data request");
    if (requestRecord.type !== "export") throw new ApiError(404, "export_not_found", "Export not found.");
    let exported: unknown;
    if (requestRecord.status === "ready" && requestRecord.payload) {
      exported = JSON.parse(String(requestRecord.payload));
    } else if (requestRecord.status === "ready" && requestRecord.objectKey && env.EXPORTS) {
      const object = await env.EXPORTS.get(String(requestRecord.objectKey));
      if (object) exported = JSON.parse(await object.text());
    }
    return json(
      {
        id: requestRecord.id,
        status: requestRecord.status,
        createdAt: requestRecord.createdAt,
        completedAt: requestRecord.completedAt,
        ...(exported !== undefined ? { export: exported } : {}),
      },
      requestId,
    );
  }
  if (path === "/data/delete" && method === "POST") {
    const body = await readJson(request);
    if (body.confirmation !== "DELETE") throw new ApiError(422, "deletion_confirmation_required", "Send confirmation exactly as DELETE.");
    const deletionId = id("dsr");
    const receipt = { id: deletionId, status: "deleted", completedAt: now() } satisfies DeletionReceipt;
    if (env.USER_STATE) {
      const deleting = await bootstrapDeletionRequest(env, actor.tokenHash, "/bootstrap-delete/start", receipt);
      if (
        deleting.identity
        && (deleting.identity.tenantId !== actor.tenantId || deleting.identity.userId !== actor.userId || deleting.identity.sessionId !== actor.sessionId)
      ) {
        throw new ApiError(409, "deletion_identity_conflict", "Deletion coordination did not match this account.");
      }
    }
    if (actor.mode === "d1" && env.DB) {
      await env.DB.prepare("DELETE FROM users WHERE tenant_id = ? AND id = ?").bind(actor.tenantId, actor.userId).run();
    } else if (actor.mode === "kv" && env.STATE) {
      // The per-token deletion coordinator is marked "deleting" first. The
      // account tombstone is then authoritative; a retry can finish either
      // phase without trusting eventually-consistent KV routing.
      if (env.USER_STATE) await tombstoneCoordinatedState(env, actor.tenantId, actor.userId);
    } else {
      volatileStates.delete(stateKey(actor.tenantId, actor.userId));
      volatileSessions.delete(actor.tokenHash);
    }
    if (env.USER_STATE) await bootstrapDeletionRequest(env, actor.tokenHash, "/bootstrap-delete/finish", receipt);
    const cleanupComplete = await cleanupDeletionRouting(env, actor.tokenHash, actor.tenantId, actor.userId);
    if (!cleanupComplete) {
      console.warn(JSON.stringify({ level: "warn", requestId, message: "Account deletion committed; ancillary KV cleanup will rely on expiry." }));
    }
    return json(receipt, requestId, 200, {
      "set-cookie": `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
    });
  }
  if (path === "/data/delete/cancel" && method === "POST") {
    const requestRecord = [...state.dataRequests].reverse().find((item) => item.type === "delete" && item.status === "scheduled");
    if (!requestRecord) throw new ApiError(404, "deletion_request_not_found", "No cancellable deletion request exists.");
    requestRecord.status = "cancelled";
    state.user.status = "active";
    await saveState(env, actor, state);
    return json({ id: requestRecord.id, status: "cancelled" }, requestId);
  }

  throw new ApiError(404, "not_found", "Route not found.");
}

async function health(env: Env, requestId: string, admin = false): Promise<Response> {
  let database: "connected" | "missing" | "error" = env.DB ? "connected" : "missing";
  let coordinator: "connected" | "missing" | "error" = env.USER_STATE ? "connected" : "missing";
  let stateKv: "connected" | "missing" | "error" = env.STATE ? "connected" : "missing";
  // Public health is a cheap binding/liveness signal. Authenticated admin
  // health performs dependency reads; the deployment canary proves writes.
  if (admin && env.DB) {
    try {
      await env.DB.prepare("SELECT 1 AS ok").first();
    } catch {
      database = "error";
    }
  }
  if (admin && env.USER_STATE) {
    try {
      const stub = env.USER_STATE.get(env.USER_STATE.idFromName("__saathkind_readiness__"));
      const probe = await stub.fetch("https://user-state.internal/state");
      if (![200, 404, 410].includes(probe.status)) coordinator = "error";
    } catch {
      coordinator = "error";
    }
  }
  if (admin && env.STATE) {
    try {
      await env.STATE.get("health:readiness-probe");
    } catch {
      stateKv = "error";
    }
  }
  const requiredUnavailable = env.REQUIRE_D1 === "true" && database !== "connected";
  const coordinatorUnavailable = env.ENVIRONMENT === "production"
    && !env.DB
    && (coordinator !== "connected" || stateKv !== "connected");
  const dependencyError = database === "error" || coordinator === "error" || stateKv === "error";
  const payload: Record<string, unknown> = {
    status: requiredUnavailable || coordinatorUnavailable || dependencyError ? "degraded" : "ok",
    version: env.API_VERSION || API_VERSION,
    environment: env.ENVIRONMENT || "development",
    timestamp: now(),
    persistence: database === "connected" ? "d1" : env.USER_STATE && env.STATE ? "durable-object-demo" : coordinatorUnavailable ? "unavailable" : env.STATE ? "kv-demo" : "volatile-demo",
  };
  if (admin) {
    payload.dependencies = {
      d1: database,
      stateKv,
      userStateCoordinator: coordinator,
      jobsQueue: !!env.JOBS_QUEUE,
      vectorize: !!env.MEMORY_INDEX,
      r2Exports: !!env.EXPORTS,
      gemini: !!env.GEMINI_API_KEY,
    };
  }
  return json(payload, requestId, requiredUnavailable || coordinatorUnavailable || dependencyError ? 503 : 200);
}

async function fetchHandler(request: Request, env: Env): Promise<Response> {
  const requestId = request.headers.get("cf-ray") || crypto.randomUUID();
  try {
    const url = new URL(request.url);
    const path = apiPath(url.pathname);
    if (path === null) {
      if (!env.ASSETS) throw new ApiError(404, "not_found", "Route not found.");
      const asset = await env.ASSETS.fetch(request);
      const headers = new Headers(asset.headers);
      headers.set("x-content-type-options", "nosniff");
      headers.set("referrer-policy", "strict-origin-when-cross-origin");
      headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
      headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
      headers.set("cross-origin-opener-policy", "same-origin");
      if (headers.get("content-type")?.includes("text/html")) {
        headers.set(
          "content-security-policy",
          "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; media-src 'self' blob:; upgrade-insecure-requests",
        );
      }
      return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers });
    }
    const origin = request.headers.get("origin");
    if (origin && !allowedOrigins(env, url).has(origin)) throw new ApiError(403, "origin_not_allowed", "Request origin is not allowed.");
    if (request.method === "OPTIONS") {
      const response = noContent(requestId);
      response.headers.set("access-control-allow-methods", "GET, POST, PATCH, DELETE, OPTIONS");
      response.headers.set("access-control-allow-headers", "authorization, content-type, idempotency-key, x-request-id");
      response.headers.set("access-control-max-age", "86400");
      return applyCors(response, request, env);
    }
    if ((path === "/health" || path === "/") && request.method === "GET") return applyCors(await health(env, requestId), request, env);
    if (path === "/pricing" && request.method === "GET") {
      return applyCors(
        json(
          {
            currency: "INR",
            plans: [
              { id: "free", name: "Free beta", monthlyPrice: 0, messages: BETA_LIFETIME_MESSAGE_LIMIT, availability: "synthetic_beta", features: ["Text demo", "User-controlled memory demo"] },
              { id: "core", name: "Core research concept", monthlyPrice: 399, messages: null, availability: "research_only", features: ["Planned only; not for sale"] },
            ],
            billingStatus: "coming_soon",
          },
          requestId,
        ),
        request,
        env,
      );
    }
    if ((path === "/auth/demo" || path === "/session/bootstrap") && request.method === "POST") {
      if (env.ENVIRONMENT === "production" && !env.DB && (!env.STATE || !env.USER_STATE)) {
        throw new ApiError(503, "state_coordinator_unavailable", "Account coordination is required for this beta.");
      }
      return applyCors(await bootstrap(request, env, requestId), request, env);
    }
    if (path === "/admin/health" && request.method === "GET") {
      await requireAdmin(request, env);
      return applyCors(await health(env, requestId, true), request, env);
    }
    if (path === "/data/delete" && request.method === "POST") {
      const suppliedToken = tokenFrom(request);
      if (suppliedToken && suppliedToken.length >= 24) {
        const tokenHash = await sha256(suppliedToken);
        const deletion = await readBootstrapDeletion(env, tokenHash);
        if (deletion) {
          const body = await readJson(request);
          if (body.confirmation !== "DELETE") {
            throw new ApiError(422, "deletion_confirmation_required", "Send confirmation exactly as DELETE.");
          }
          let receipt = deletion.receipt;
          if (deletion.status === "deleting") {
            if (!deletion.identity) throw new ApiError(503, "deletion_coordination_unavailable", "Deletion identity could not be recovered.");
            await tombstoneCoordinatedState(env, deletion.identity.tenantId, deletion.identity.userId);
            receipt = (await bootstrapDeletionRequest(env, tokenHash, "/bootstrap-delete/finish", receipt)).receipt;
          }
          if (deletion.identity) {
            await cleanupDeletionRouting(env, tokenHash, deletion.identity.tenantId, deletion.identity.userId);
          }
          return applyCors(json(receipt, requestId, 200, {
            "set-cookie": `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
          }), request, env);
        }
      }
    }
    if (env.ENVIRONMENT === "production" && !env.DB && (!env.STATE || !env.USER_STATE)) {
      throw new ApiError(503, "state_coordinator_unavailable", "Account coordination is required for this beta.");
    }
    const { actor, state } = await authenticate(request, env);
    await enforceRate(env, `api:${actor.tenantId}:${actor.userId}`, 180, 60);
    const response = await routeAuthed({
      request,
      env,
      actor,
      state,
      requestId,
      url,
      path,
      segments: path.split("/").filter(Boolean),
    });
    return applyCors(response, request, env);
  } catch (error) {
    return applyCors(errorResponse(error, requestId), request, env);
  }
}

export default {
  fetch: fetchHandler,
};

export { assessSafety, fetchHandler, isQuietTime };
