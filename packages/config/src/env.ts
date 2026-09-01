import { z } from "zod";

const serverSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ORIGIN: z.url().default("http://localhost:3000"),
  API_ORIGIN: z.url().default("http://localhost:4000"),
  DATABASE_URL: z.string().min(1).default("postgresql://companion:companion_local_only@localhost:5432/companion"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  SESSION_SECRET: z.string().min(32).default("development-only-session-secret-change-me"),
  ADMIN_API_KEY: z.string().min(12).default("local-admin-key-change-me"),
  S3_ENDPOINT: z.url().default("http://localhost:9000"),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("companion-local"),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  AI_MOCK_MODE: z.string().default("true").transform((value) => value === "true"),
  CHAT_PROVIDER: z.enum(["mock", "openai"]).default("mock"),
  EMBEDDING_PROVIDER: z.enum(["mock", "openai"]).default("mock"),
  MODERATION_PROVIDER: z.enum(["local", "mock", "openai"]).default("local"),
  STT_PROVIDER: z.enum(["mock", "openai"]).default("mock"),
  TTS_PROVIDER: z.enum(["mock", "openai"]).default("mock"),
  REALTIME_VOICE_PROVIDER: z.enum(["mock", "openai"]).default("mock"),
  VISION_PROVIDER: z.enum(["mock", "openai"]).default("mock"),
  IMAGE_GENERATION_PROVIDER: z.enum(["mock", "openai"]).default("mock"),
  CHAT_MODEL: z.string().default("mock-companion-v1"),
  EMBEDDING_MODEL: z.string().default("mock-embedding-v1"),
  MODERATION_MODEL: z.string().default("omni-moderation-latest"),
  REALTIME_MODEL: z.string().default("gpt-realtime-2.1"),
  TRANSCRIPTION_MODEL: z.string().default("gpt-4o-mini-transcribe"),
  SPEECH_MODEL: z.string().default("gpt-4o-mini-tts"),
  VISION_MODEL: z.string().default("gpt-5.5"),
  IMAGE_MODEL: z.string().default("gpt-image-2"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.url().default("https://api.openai.com/v1"),
  PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(45_000),
  PERSISTENCE_PROVIDER: z.enum(["memory", "postgres"]).default("memory"),
  STORAGE_PROVIDER: z.enum(["memory", "s3"]).default("memory"),
  QUEUE_PROVIDER: z.enum(["memory", "redis"]).default("memory"),
  NOTIFICATION_PROVIDER: z.enum(["console", "webhook"]).default("console"),
  NOTIFICATION_WEBHOOK_URL: z.url().optional(),
  BILLING_ENABLED: z.string().default("false").transform((value) => value === "true"),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  REVENUECAT_WEBHOOK_SECRET: z.string().optional(),
  ERROR_REPORTING_DSN: z.string().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

export function parseServerEnv(input: Record<string, string | undefined>): ServerEnv {
  const parsed = serverSchema.parse(input);
  if (parsed.APP_ENV === "production" && parsed.SESSION_SECRET === "development-only-session-secret-change-me") {
    throw new Error("SESSION_SECRET must be replaced in production");
  }
  if (parsed.APP_ENV === "production" && parsed.ADMIN_API_KEY === "local-admin-key-change-me") {
    throw new Error("ADMIN_API_KEY must be replaced in production");
  }
  const aiProviders = [parsed.CHAT_PROVIDER, parsed.EMBEDDING_PROVIDER, parsed.MODERATION_PROVIDER, parsed.STT_PROVIDER, parsed.TTS_PROVIDER, parsed.REALTIME_VOICE_PROVIDER, parsed.VISION_PROVIDER, parsed.IMAGE_GENERATION_PROVIDER];
  if (!parsed.AI_MOCK_MODE && aiProviders.includes("openai") && !parsed.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required when an OpenAI provider is enabled");
  }
  if (parsed.APP_ENV === "production" && (parsed.AI_MOCK_MODE || aiProviders.some((provider) => provider !== "openai"))) {
    throw new Error("Production requires AI_MOCK_MODE=false and all AI providers set to openai");
  }
  if (parsed.APP_ENV === "production" && parsed.PERSISTENCE_PROVIDER !== "postgres") {
    throw new Error("PERSISTENCE_PROVIDER must be postgres in production");
  }
  if (parsed.APP_ENV === "production" && parsed.QUEUE_PROVIDER !== "redis") {
    throw new Error("QUEUE_PROVIDER must be redis in production");
  }
  if (parsed.APP_ENV === "production" && parsed.STORAGE_PROVIDER !== "s3") {
    throw new Error("STORAGE_PROVIDER must be s3 in production");
  }
  if (parsed.APP_ENV === "production" && (!parsed.S3_ACCESS_KEY_ID || !parsed.S3_SECRET_ACCESS_KEY)) {
    throw new Error("S3 credentials are required in production");
  }
  if (parsed.APP_ENV === "production" && (parsed.NOTIFICATION_PROVIDER !== "webhook" || !parsed.NOTIFICATION_WEBHOOK_URL)) {
    throw new Error("A notification webhook must be configured in production");
  }
  return parsed;
}
