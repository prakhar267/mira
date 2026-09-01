import { CreateBucketCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createClient, type RedisClientType } from "redis";
import type { ServerEnv } from "@companion/config";

export interface InfrastructureHealth {
  redis: "disabled" | "ready" | "unavailable";
  storage: "disabled" | "ready" | "unavailable";
}

export class InfrastructureServices {
  private redis?: RedisClientType;
  private s3?: S3Client;

  constructor(private readonly env: ServerEnv) {
    if (env.QUEUE_PROVIDER === "redis") this.redis = createClient({ url: env.REDIS_URL });
    if (env.STORAGE_PROVIDER === "s3") {
      this.s3 = new S3Client({
        endpoint: env.S3_ENDPOINT,
        region: env.S3_REGION,
        forcePathStyle: true,
        credentials: { accessKeyId: env.S3_ACCESS_KEY_ID ?? "", secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "" },
      });
    }
  }

  async connect() {
    if (this.redis && !this.redis.isOpen) await this.redis.connect();
    if (this.s3) {
      try {
        await this.s3.send(new HeadBucketCommand({ Bucket: this.env.S3_BUCKET }));
      } catch (error) {
        if (this.env.APP_ENV === "production") throw error;
        await this.s3.send(new CreateBucketCommand({ Bucket: this.env.S3_BUCKET }));
      }
    }
  }

  async health(): Promise<InfrastructureHealth> {
    let redis: InfrastructureHealth["redis"] = this.redis ? "unavailable" : "disabled";
    let storage: InfrastructureHealth["storage"] = this.s3 ? "unavailable" : "disabled";
    if (this.redis) {
      try { if (!this.redis.isOpen) await this.redis.connect(); redis = await this.redis.ping() === "PONG" ? "ready" : "unavailable"; } catch { redis = "unavailable"; }
    }
    if (this.s3) {
      try { await this.s3.send(new HeadBucketCommand({ Bucket: this.env.S3_BUCKET })); storage = "ready"; } catch { storage = "unavailable"; }
    }
    return { redis, storage };
  }

  async enqueueNudge(nudge: { id: string; scheduledFor: string; userId: string }) {
    if (!this.redis) return false;
    if (!this.redis.isOpen) await this.redis.connect();
    await this.redis.zAdd("companion:nudges", { score: new Date(nudge.scheduledFor).getTime(), value: JSON.stringify(nudge) });
    return true;
  }

  async checkRateLimit(key: string, limit: number, windowMs: number) {
    if (!this.redis) return null;
    if (!this.redis.isOpen) await this.redis.connect();
    const redisKey = `companion:rate:${key}`;
    const count = await this.redis.incr(redisKey);
    if (count === 1) await this.redis.pExpire(redisKey, windowMs);
    return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
  }

  async putMedia(input: { key: string; contentType: string; bytes: Uint8Array }) {
    if (!this.s3) return null;
    await this.s3.send(new PutObjectCommand({ Bucket: this.env.S3_BUCKET, Key: input.key, ContentType: input.contentType, Body: input.bytes }));
    return `${this.env.S3_ENDPOINT.replace(/\/$/, "")}/${this.env.S3_BUCKET}/${encodeURIComponent(input.key)}`;
  }

  async sendNotification(input: { kind: "email-verification" | "password-reset" | "nudge"; userId?: string; email?: string; title: string; body: string; actionUrl?: string }) {
    if (this.env.NOTIFICATION_PROVIDER === "console") {
      if (this.env.APP_ENV !== "production") console.info(`[notification:${input.kind}] ${input.title}`);
      return { delivered: false, provider: "console" as const };
    }
    if (!this.env.NOTIFICATION_WEBHOOK_URL) throw new Error("Notification webhook is not configured");
    const response = await fetch(this.env.NOTIFICATION_WEBHOOK_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Notification provider returned ${response.status}`);
    return { delivered: true, provider: "webhook" as const };
  }

  async close() {
    if (this.redis?.isOpen) await this.redis.quit();
    this.s3?.destroy();
  }
}
