import type { DemoState, DurableObjectStateLike } from "./types.ts";

type StateRecord = {
  revision: number;
  deleted: boolean;
  state?: DemoState;
  sessions?: Record<string, SessionRecord>;
  expiresAt?: number;
};

type SessionRecord = {
  sessionId: string;
  expiresAt: number;
  revokedAt?: number;
};

type InitializePayload = {
  state: DemoState;
  session: SessionRecord & { tokenHash: string };
};

type RateLimitPayload = {
  limit: number;
  seconds: number;
  subject?: string;
};

type RateLimitRecord = {
  bucket: number;
  hits: number;
  expiresAt: number;
  subjects?: string[];
};

type BootstrapClaimPayload = {
  fingerprint: string;
  expiresAt: number;
  identity?: {
    tenantId: string;
    userId: string;
    sessionId: string;
    accountCreatedAt: string;
  };
};

type ActiveBootstrapClaimRecord = Omit<BootstrapClaimPayload, "identity"> & {
  identity: NonNullable<BootstrapClaimPayload["identity"]>;
  createdAt: number;
  leaseExpiresAt: number;
  status: "pending" | "committed";
};

type DeletionReceipt = {
  id: string;
  status: "deleted";
  completedAt: string;
};

type BootstrapClaimRecord = ActiveBootstrapClaimRecord | {
  status: "deleting";
  expiresAt: number;
  identity: ActiveBootstrapClaimRecord["identity"];
  receipt: DeletionReceipt;
} | {
  status: "deleted";
  expiresAt: number;
  receipt: DeletionReceipt;
};

const RECORD_KEY = "account-state";
const RATE_LIMIT_KEY = "rate-limit";
const BOOTSTRAP_CLAIM_KEY = "bootstrap-claim";
const MAX_STATE_BYTES = 1_800_000;

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function assertStateSize(state: DemoState): DemoState {
  const size = new TextEncoder().encode(JSON.stringify(state)).byteLength;
  if (size > MAX_STATE_BYTES) {
    throw new RangeError("Account state exceeds the synthetic beta storage limit.");
  }
  return state;
}

async function readState(request: Request): Promise<DemoState> {
  return assertStateSize((await request.json()) as DemoState);
}

/**
 * Serializes each synthetic beta account behind one SQLite-backed Durable
 * Object. Writes use optimistic revisions, while deletion writes a permanent
 * tombstone so an older in-flight request can never recreate account state.
 */
export class UserStateCoordinator {
  private readonly state: DurableObjectStateLike;
  private readonly storage: DurableObjectStateLike["storage"];

  constructor(state: DurableObjectStateLike) {
    this.state = state;
    this.storage = state.storage;
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    let submittedState: DemoState | undefined;
    let initializePayload: InitializePayload | undefined;
    let sessionPayload: (SessionRecord & { tokenHash: string }) | undefined;
    let rateLimitPayload: RateLimitPayload | undefined;
    let bootstrapClaimPayload: BootstrapClaimPayload | undefined;
    let bootstrapDeletePayload: { expiresAt: number; receipt: DeletionReceipt } | undefined;
    if (path === "/initialize" && request.method === "POST") {
      try {
        initializePayload = (await request.json()) as InitializePayload;
        submittedState = assertStateSize(initializePayload.state);
      } catch (error) {
        if (error instanceof RangeError) return response({ code: "state_too_large", message: error.message }, 413);
        return response({ code: "invalid_initialize_payload" }, 400);
      }
      const session = initializePayload?.session;
      if (
        !submittedState?.tenantId
        || !submittedState.user?.id
        || !session
        || !session.tokenHash
        || !session.sessionId
        || !Number.isFinite(session.expiresAt)
        || session.expiresAt <= Date.now()
      ) {
        return response({ code: "invalid_initialize_payload" }, 400);
      }
      sessionPayload = session;
    } else if (path === "/state" && request.method === "PUT") {
      try {
        submittedState = await readState(request);
      } catch (error) {
        if (error instanceof RangeError) return response({ code: "state_too_large", message: error.message }, 413);
        return response({ code: "invalid_state_payload" }, 400);
      }
    } else if (["/session/validate", "/session/revoke"].includes(path) && request.method === "POST") {
      try {
        sessionPayload = (await request.json()) as SessionRecord & { tokenHash: string };
      } catch {
        return response({ code: "invalid_session_payload" }, 400);
      }
    } else if (path === "/rate-limit" && request.method === "POST") {
      try {
        const parsed = (await request.json()) as RateLimitPayload;
        if (!Number.isInteger(parsed.limit) || parsed.limit < 1 || parsed.limit > 10_000) throw new Error("invalid limit");
        if (!Number.isInteger(parsed.seconds) || parsed.seconds < 1 || parsed.seconds > 86_400) throw new Error("invalid window");
        if (parsed.subject !== undefined && !/^[a-f0-9]{64,128}$/i.test(parsed.subject)) throw new Error("invalid subject");
        rateLimitPayload = parsed;
      } catch {
        return response({ code: "invalid_rate_limit_payload" }, 400);
      }
    } else if (["/bootstrap-claim", "/bootstrap-commit"].includes(path) && request.method === "POST") {
      try {
        const parsed = (await request.json()) as BootstrapClaimPayload;
        if (!/^[a-f0-9]{64}$/i.test(parsed.fingerprint || "")) throw new Error("invalid fingerprint");
        if (!Number.isFinite(parsed.expiresAt) || parsed.expiresAt <= Date.now()) throw new Error("invalid expiry");
        if (path === "/bootstrap-claim") {
          const identity = parsed.identity;
          if (
            !identity
            || !identity.tenantId
            || !identity.userId
            || !identity.sessionId
            || !Number.isFinite(Date.parse(identity.accountCreatedAt))
          ) throw new Error("invalid identity");
        }
        bootstrapClaimPayload = parsed;
      } catch {
        return response({ code: "invalid_bootstrap_claim" }, 400);
      }
    } else if (["/bootstrap-delete/start", "/bootstrap-delete/finish"].includes(path) && request.method === "POST") {
      try {
        const parsed = (await request.json()) as { expiresAt: number; receipt: DeletionReceipt };
        if (!Number.isFinite(parsed.expiresAt) || parsed.expiresAt <= Date.now()) throw new Error("invalid expiry");
        if (!parsed.receipt?.id || parsed.receipt.status !== "deleted" || !Number.isFinite(Date.parse(parsed.receipt.completedAt))) {
          throw new Error("invalid receipt");
        }
        bootstrapDeletePayload = parsed;
      } catch {
        return response({ code: "invalid_bootstrap_deletion" }, 400);
      }
    }

    return this.state.blockConcurrencyWhile(async () => {
      if (path === "/bootstrap-claim" && request.method === "POST") {
        const submitted = bootstrapClaimPayload as BootstrapClaimPayload;
        const currentClaim = await this.storage.get<BootstrapClaimRecord>(BOOTSTRAP_CLAIM_KEY);
        if (currentClaim && currentClaim.expiresAt > Date.now()) {
          // Every idempotent/recovery request also repairs the immutable claim
          // alarm. A prior partial write can therefore never make token-hash
          // metadata outlive the account's fixed expiry.
          await this.storage.setAlarm?.(currentClaim.expiresAt);
          if (currentClaim.status === "deleting" || currentClaim.status === "deleted") {
            return response({ code: "bootstrap_token_deleted" }, 409);
          }
          if (currentClaim.fingerprint !== submitted.fingerprint) {
            return response({ code: "bootstrap_token_conflict" }, 409);
          }
          if (currentClaim.status === "committed" || currentClaim.leaseExpiresAt > Date.now()) {
            return response({ owner: false, status: currentClaim.status, claimedAt: currentClaim.createdAt, expiresAt: currentClaim.expiresAt, identity: currentClaim.identity });
          }
          currentClaim.leaseExpiresAt = Date.now() + 5_000;
          await this.storage.put(BOOTSTRAP_CLAIM_KEY, currentClaim);
          return response({ owner: true, status: "pending", claimedAt: currentClaim.createdAt, expiresAt: currentClaim.expiresAt, identity: currentClaim.identity });
        }
        const claim = {
          fingerprint: submitted.fingerprint,
          expiresAt: submitted.expiresAt,
          identity: submitted.identity as NonNullable<BootstrapClaimPayload["identity"]>,
          createdAt: Date.now(),
          leaseExpiresAt: Date.now() + 5_000,
          status: "pending",
        } satisfies BootstrapClaimRecord;
        await this.storage.setAlarm?.(submitted.expiresAt);
        await this.storage.put(BOOTSTRAP_CLAIM_KEY, claim);
        return response({ owner: true, status: claim.status, claimedAt: claim.createdAt, expiresAt: claim.expiresAt, identity: claim.identity }, 201);
      }

      if (path === "/bootstrap-commit" && request.method === "POST") {
        const submitted = bootstrapClaimPayload as BootstrapClaimPayload;
        const currentClaim = await this.storage.get<BootstrapClaimRecord>(BOOTSTRAP_CLAIM_KEY);
        if (!currentClaim || (currentClaim.status !== "pending" && currentClaim.status !== "committed") || currentClaim.fingerprint !== submitted.fingerprint || currentClaim.expiresAt <= Date.now()) {
          return response({ code: "bootstrap_claim_missing" }, 409);
        }
        const activeClaim = currentClaim as ActiveBootstrapClaimRecord;
        activeClaim.status = "committed";
        activeClaim.leaseExpiresAt = activeClaim.expiresAt;
        await this.storage.setAlarm?.(activeClaim.expiresAt);
        await this.storage.put(BOOTSTRAP_CLAIM_KEY, activeClaim);
        return response({ committed: true });
      }

      if (path === "/bootstrap-delete/status" && request.method === "GET") {
        const currentClaim = await this.storage.get<BootstrapClaimRecord>(BOOTSTRAP_CLAIM_KEY);
        if (!currentClaim || !["deleting", "deleted"].includes(currentClaim.status) || currentClaim.expiresAt <= Date.now()) {
          return response({ code: "deletion_receipt_not_found" }, 404);
        }
        return response(currentClaim);
      }

      if (path === "/bootstrap-route" && request.method === "GET") {
        const currentClaim = await this.storage.get<BootstrapClaimRecord>(BOOTSTRAP_CLAIM_KEY);
        if (!currentClaim || currentClaim.status !== "committed" || currentClaim.expiresAt <= Date.now()) {
          return response({ code: "bootstrap_route_not_found" }, 404);
        }
        return response({ identity: currentClaim.identity, expiresAt: currentClaim.expiresAt });
      }

      if (path === "/bootstrap-delete/start" && request.method === "POST") {
        const submitted = bootstrapDeletePayload as { expiresAt: number; receipt: DeletionReceipt };
        const currentClaim = await this.storage.get<BootstrapClaimRecord>(BOOTSTRAP_CLAIM_KEY);
        if (currentClaim?.status === "deleted" || currentClaim?.status === "deleting") return response(currentClaim);
        if (!currentClaim || currentClaim.expiresAt <= Date.now()) return response({ code: "bootstrap_claim_missing" }, 409);
        const deleting = {
          status: "deleting",
          // Deletion status never extends the token/account retention horizon.
          expiresAt: currentClaim.expiresAt,
          identity: currentClaim.identity,
          receipt: submitted.receipt,
        } satisfies BootstrapClaimRecord;
        await this.storage.setAlarm?.(deleting.expiresAt);
        await this.storage.put(BOOTSTRAP_CLAIM_KEY, deleting);
        return response(deleting);
      }

      if (path === "/bootstrap-delete/finish" && request.method === "POST") {
        const submitted = bootstrapDeletePayload as { expiresAt: number; receipt: DeletionReceipt };
        const currentClaim = await this.storage.get<BootstrapClaimRecord>(BOOTSTRAP_CLAIM_KEY);
        if (currentClaim?.status === "deleted") return response(currentClaim);
        if (!currentClaim || currentClaim.status !== "deleting") return response({ code: "bootstrap_deletion_not_started" }, 409);
        const deleted = { status: "deleted", expiresAt: currentClaim.expiresAt, receipt: currentClaim.receipt } satisfies BootstrapClaimRecord;
        await this.storage.setAlarm?.(deleted.expiresAt);
        await this.storage.put(BOOTSTRAP_CLAIM_KEY, deleted);
        return response(deleted);
      }

      if (path === "/rate-limit" && request.method === "POST") {
        const { limit, seconds } = rateLimitPayload as RateLimitPayload;
        const timestamp = Date.now();
        const bucket = Math.floor(timestamp / (seconds * 1_000));
        const currentRate = await this.storage.get<RateLimitRecord>(RATE_LIMIT_KEY);
        const activeBucket = currentRate?.bucket === bucket && currentRate.expiresAt > timestamp;
        if (activeBucket && rateLimitPayload?.subject && currentRate.subjects?.includes(rateLimitPayload.subject)) {
          return response({ allowed: true, duplicate: true, hits: currentRate.hits, remaining: Math.max(limit - currentRate.hits, 0) });
        }
        if (activeBucket && currentRate.hits >= limit) {
          // Once blocked, do not let abusive retries consume additional
          // SQLite writes. The fixed-window record already proves the block.
          return response({ code: "rate_limit_exceeded", hits: currentRate.hits, retryAfterSeconds: seconds }, 429);
        }
        const expiresAt = (bucket + 2) * seconds * 1_000;
        const hits = activeBucket ? currentRate.hits + 1 : 1;
        if (!activeBucket) {
          // Schedule retention before writing the first counter so a failed
          // alarm can never leave an unscheduled rate-limit record behind.
          await this.storage.setAlarm?.(expiresAt);
        }
        const subjects = rateLimitPayload?.subject
          ? [...(activeBucket ? currentRate.subjects || [] : []), rateLimitPayload.subject]
          : undefined;
        await this.storage.put(RATE_LIMIT_KEY, { bucket, hits, expiresAt, ...(subjects ? { subjects } : {}) } satisfies RateLimitRecord);
        return response({ allowed: true, hits, remaining: Math.max(limit - hits, 0) });
      }

      const current = await this.storage.get<StateRecord>(RECORD_KEY);

      if (path === "/state" && request.method === "GET") {
        if (current?.deleted) return response({ code: "account_deleted" }, 410);
        if (!current?.state) return response({ code: "state_not_found" }, 404);
        return response({ state: current.state, revision: current.revision });
      }

      if (path === "/initialize" && request.method === "POST") {
        if (current?.deleted) return response({ code: "account_deleted" }, 410);
        const session = sessionPayload as SessionRecord & { tokenHash: string };
        if (current?.state) {
          const existingSession = current.sessions?.[session.tokenHash];
          if (
            current.state.tenantId === submittedState?.tenantId
            && current.state.user.id === submittedState.user.id
            && existingSession?.sessionId === session.sessionId
          ) {
            // An earlier initialize may have committed its record before an
            // alarm failure interrupted the response. Repair/confirm the
            // immutable retention alarm on every idempotent retry.
            await this.storage.setAlarm?.(current.expiresAt || session.expiresAt);
            return response({ revision: current.revision, existing: true });
          }
          return response({ code: "account_already_initialized" }, 409);
        }
        const record: StateRecord = {
          revision: 1,
          deleted: false,
          state: submittedState,
          sessions: {
            [session.tokenHash]: { sessionId: session.sessionId, expiresAt: session.expiresAt },
          },
          expiresAt: session.expiresAt,
        };
        // Schedule retention before committing submitted profile/consent data.
        // A harmless alarm without a record is preferable to content that has
        // no expiry if the two storage operations do not both complete.
        await this.storage.setAlarm?.(session.expiresAt);
        await this.storage.put(RECORD_KEY, record);
        return response({ revision: record.revision }, 201);
      }

      if (path === "/session/validate" && request.method === "POST") {
        if (current?.deleted || !current?.state) return response({ code: "invalid_session" }, 401);
        const submitted = sessionPayload as SessionRecord & { tokenHash: string };
        const session = current.sessions?.[submitted.tokenHash];
        if (!session || session.sessionId !== submitted.sessionId || session.revokedAt || session.expiresAt <= Date.now()) {
          return response({ code: "invalid_session" }, 401);
        }
        return response({ valid: true, revision: current.revision });
      }

      if (path === "/session/revoke" && request.method === "POST") {
        if (current?.deleted || !current?.state) return response({ revoked: true });
        const submitted = sessionPayload as SessionRecord & { tokenHash: string };
        const session = current.sessions?.[submitted.tokenHash];
        if (session && session.sessionId === submitted.sessionId && !session.revokedAt) {
          session.revokedAt = Date.now();
          current.revision += 1;
          await this.storage.put(RECORD_KEY, current);
        }
        return response({ revoked: true, revision: current.revision });
      }

      if (path === "/state" && request.method === "PUT") {
        if (current?.deleted) return response({ code: "account_deleted" }, 410);
        if (!current?.state) return response({ code: "state_not_found" }, 404);
        const expectedRevision = Number(request.headers.get("if-match"));
        if (!Number.isInteger(expectedRevision) || expectedRevision !== current.revision) {
          return response({ code: "state_conflict", currentRevision: current.revision }, 409);
        }
        const record: StateRecord = {
          revision: current.revision + 1,
          deleted: false,
          state: submittedState,
          sessions: current.sessions,
          expiresAt: current.expiresAt,
        };
        await this.storage.put(RECORD_KEY, record);
        return response({ revision: record.revision });
      }

      if (path === "/state" && request.method === "DELETE") {
        const revision = (current?.revision || 0) + 1;
        await this.storage.put(RECORD_KEY, { revision, deleted: true, expiresAt: current?.expiresAt } satisfies StateRecord);
        return response({ deleted: true, revision });
      }

      return response({ code: "not_found" }, 404);
    });
  }

  async alarm(): Promise<void> {
    await this.state.blockConcurrencyWhile(async () => {
      const currentRate = await this.storage.get<RateLimitRecord>(RATE_LIMIT_KEY);
      if (currentRate) {
        if (currentRate.expiresAt <= Date.now()) await this.storage.delete?.(RATE_LIMIT_KEY);
        else await this.storage.setAlarm?.(currentRate.expiresAt);
      }
      const bootstrapClaim = await this.storage.get<BootstrapClaimRecord>(BOOTSTRAP_CLAIM_KEY);
      if (bootstrapClaim) {
        if (bootstrapClaim.expiresAt <= Date.now()) await this.storage.delete?.(BOOTSTRAP_CLAIM_KEY);
        else await this.storage.setAlarm?.(bootstrapClaim.expiresAt);
      }
      const current = await this.storage.get<StateRecord>(RECORD_KEY);
      if (!current || current.deleted || !current.expiresAt || current.expiresAt > Date.now()) {
        if (current?.expiresAt && !current.deleted) await this.storage.setAlarm?.(current.expiresAt);
        return;
      }
      await this.storage.put(RECORD_KEY, {
        revision: current.revision + 1,
        deleted: true,
        expiresAt: current.expiresAt,
      } satisfies StateRecord);
    });
  }
}
