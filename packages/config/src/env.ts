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
  AI_MOCK_MODE: z.string().default("true").transform((value) => value === "true"),
  CHAT_PROVIDER: z.string().default("mock"),
  EMBEDDING_PROVIDER: z.string().default("mock"),
  MODERATION_PROVIDER: z.string().default("local"),
  STT_PROVIDER: z.string().default("mock"),
  TTS_PROVIDER: z.string().default("mock"),
  REALTIME_VOICE_PROVIDER: z.string().default("mock"),
  VISION_PROVIDER: z.string().default("mock"),
  IMAGE_GENERATION_PROVIDER: z.string().default("mock"),
  CHAT_MODEL: z.string().default("mock-companion-v1"),
  EMBEDDING_MODEL: z.string().default("mock-embedding-v1"),
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
  return parsed;
}
