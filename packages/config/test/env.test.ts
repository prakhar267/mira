import { describe, expect, it } from "vitest";
import { parseServerEnv } from "../src/env";

const productionEnv = {
  APP_ENV: "production",
  APP_ORIGIN: "https://app.example.com",
  API_ORIGIN: "https://api.example.com",
  SESSION_SECRET: "a-production-session-secret-with-at-least-32-characters",
  ADMIN_API_KEY: "a-production-admin-key",
  AI_MOCK_MODE: "false",
  CHAT_PROVIDER: "openai",
  EMBEDDING_PROVIDER: "openai",
  MODERATION_PROVIDER: "openai",
  STT_PROVIDER: "openai",
  TTS_PROVIDER: "openai",
  REALTIME_VOICE_PROVIDER: "openai",
  VISION_PROVIDER: "openai",
  IMAGE_GENERATION_PROVIDER: "openai",
  OPENAI_API_KEY: "test-only-openai-key",
  PERSISTENCE_PROVIDER: "postgres",
  QUEUE_PROVIDER: "redis",
  STORAGE_PROVIDER: "s3",
  S3_ACCESS_KEY_ID: "test-only-access-key",
  S3_SECRET_ACCESS_KEY: "test-only-secret-key",
  NOTIFICATION_PROVIDER: "webhook",
  NOTIFICATION_WEBHOOK_URL: "https://notifications.example.com/events",
} as const;

describe("server environment", () => {
  it("accepts a fully configured production runtime", () => {
    expect(parseServerEnv(productionEnv).APP_ENV).toBe("production");
  });

  it("fails closed when a production AI provider is mocked", () => {
    expect(() => parseServerEnv({ ...productionEnv, CHAT_PROVIDER: "mock" })).toThrow(/all AI providers/);
  });

  it("fails closed when production object-storage credentials are missing", () => {
    expect(() => parseServerEnv({ ...productionEnv, S3_SECRET_ACCESS_KEY: undefined })).toThrow(/S3 credentials/);
  });
});
