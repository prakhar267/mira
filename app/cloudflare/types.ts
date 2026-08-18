export interface D1Result<T = Record<string, unknown>> {
  success: boolean;
  results?: T[];
  meta?: Record<string, unknown>;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

export interface KVNamespace {
  get<T = unknown>(key: string, type: "json"): Promise<T | null>;
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expiration?: number; expirationTtl?: number; metadata?: unknown },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface QueueBinding<T = unknown> {
  send(message: T, options?: { contentType?: "json" | "text" | "bytes"; delaySeconds?: number }): Promise<void>;
}

export interface VectorizeBinding {
  upsert(vectors: Array<{ id: string; values: number[]; metadata?: Record<string, unknown> }>): Promise<unknown>;
  deleteByIds(ids: string[]): Promise<unknown>;
}

export interface R2ObjectBody {
  text(): Promise<string>;
}

export interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  put(key: string, value: string | ArrayBuffer | ReadableStream, options?: Record<string, unknown>): Promise<unknown>;
  delete(key: string): Promise<void>;
}

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

export interface ScheduledControllerLike {
  scheduledTime: number;
  cron: string;
}

export interface QueueMessage<T> {
  body: T;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

export interface QueueBatch<T> {
  queue: string;
  messages: QueueMessage<T>[];
}

export interface DurableObjectStorageLike {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
  delete?(key: string): Promise<boolean>;
  setAlarm?(scheduledTime: number | Date): Promise<void>;
}

export interface DurableObjectStateLike {
  storage: DurableObjectStorageLike;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}

export interface DurableObjectStubLike {
  fetch(input: Request | string | URL, init?: RequestInit): Promise<Response>;
}

export interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStubLike;
}

export interface Env {
  ASSETS?: { fetch(request: Request): Promise<Response> };
  DB?: D1Database;
  STATE?: KVNamespace;
  RATE_LIMIT?: KVNamespace;
  JOBS_QUEUE?: QueueBinding<JobMessage>;
  EXPORTS?: R2Bucket;
  MEMORY_INDEX?: VectorizeBinding;
  USER_STATE?: DurableObjectNamespaceLike;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  ENABLE_GEMINI?: string;
  ADMIN_API_KEY?: string;
  DEFAULT_TENANT_ID?: string;
  CORS_ORIGINS?: string;
  ALLOW_DEMO_AUTH?: string;
  REQUIRE_D1?: string;
  ENVIRONMENT?: string;
  API_VERSION?: string;
}

export type JobMessage =
  | { type: "followup.due"; tenantId: string; userId: string; followupId: string }
  | { type: "export.build"; tenantId: string; userId: string; requestId: string }
  | { type: "account.delete"; tenantId: string; userId: string; requestId: string };

export interface Actor {
  tenantId: string;
  userId: string;
  sessionId: string;
  email?: string | null;
  status: string;
  mode: "d1" | "kv" | "volatile";
  tokenHash: string;
  stateRevision?: number;
}

export interface DemoState {
  version: 1;
  tenantId: string;
  user: {
    id: string;
    email: string | null;
    displayName: string;
    status: "active" | "deletion_pending";
    createdAt: string;
  };
  profile: {
    timezone: string;
    language: "en" | "hi" | "hinglish";
    pronouns: string | null;
    quietStart: string;
    quietEnd: string;
    followupsEnabled: boolean;
    memoryPaused: boolean;
  };
  consents: Record<string, { granted: boolean; updatedAt: string }>;
  consentEvents: Array<{ id: string; purpose: string; granted: boolean; policyVersion: string; source: string; createdAt: string }>;
  conversations: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
  memories: Array<Record<string, unknown>>;
  followups: Array<Record<string, unknown>>;
  goals: Array<Record<string, unknown>>;
  dataRequests: Array<Record<string, unknown>>;
  usage: Record<string, number>;
  usagePeriod?: string;
  idempotency: Record<string, { hash: string; status: number; body: string; createdAt: string }>;
}
