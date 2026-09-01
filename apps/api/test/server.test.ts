import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createServer } from "../src/server";

let app: FastifyInstance;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await createServer();
});

afterAll(async () => {
  await app.close();
});

describe("Companion API", () => {
  it("reports mock provider health without private configuration", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.mockMode).toBe(true);
    expect(JSON.stringify(response.json())).not.toContain("SESSION_SECRET");
  });

  it("rejects an invalid chat request", async () => {
    const response = await app.inject({ method: "POST", url: "/chat/stream", payload: { content: "hello" } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_message");
  });

  it("keeps activity rewards idempotent", async () => {
    const payload = { idempotencyKey: "activity-test-0001" };
    const first = await app.inject({ method: "POST", url: "/activities/activity-reflection/complete", payload });
    const second = await app.inject({ method: "POST", url: "/activities/activity-reflection/complete", payload });
    expect(first.statusCode).toBe(200);
    expect(second.json().data).toEqual(first.json().data);
  });

  it("creates journals and future-event nudges", async () => {
    const journal = await app.inject({ method: "POST", url: "/journal", payload: { title: "After the interview", content: "I am proud that I stayed present.", mood: "thoughtful", tags: ["work"] } });
    expect(journal.statusCode).toBe(201);
    const event = await app.inject({ method: "POST", url: "/events", payload: { description: "final interview", eventDate: "2026-09-12T10:00:00.000Z", status: "confirmed" } });
    expect(event.statusCode).toBe(201);
    expect(event.json().data.nudge.content).toContain("final interview");
  });

  it("enforces and updates subscription entitlements in test mode", async () => {
    const gated = await app.inject({ method: "POST", url: "/voice/session" });
    expect(gated.statusCode).toBe(402);
    const upgrade = await app.inject({ method: "POST", url: "/subscriptions/mock-upgrade", payload: { planId: "ultra", idempotencyKey: "upgrade-test-0001" } });
    expect(upgrade.statusCode).toBe(200);
    expect(upgrade.json().data.entitlements).toContain("voiceCalls");
    const voice = await app.inject({ method: "POST", url: "/voice/session" });
    expect(voice.statusCode).toBe(200);
  });

  it("purchases a store item idempotently and exposes the immutable ledger", async () => {
    const payload = { itemId: "midnight-blue", idempotencyKey: "purchase-test-0001" };
    const first = await app.inject({ method: "POST", url: "/store/purchase", payload });
    const second = await app.inject({ method: "POST", url: "/store/purchase", payload });
    expect(first.statusCode).toBe(200);
    expect(second.json().data.wallet).toEqual(first.json().data.wallet);
    const transactions = await app.inject({ method: "GET", url: "/wallet/transactions" });
    expect(transactions.json().data.some((transaction: { referenceId: string }) => transaction.referenceId === "midnight-blue")).toBe(true);
  });

  it("supports safe media analysis and protects admin telemetry", async () => {
    const media = await app.inject({ method: "POST", url: "/media/analyze", payload: { dataBase64: "bW9jaw==", contentType: "image/jpeg", prompt: "What is here?" } });
    expect(media.statusCode).toBe(200);
    expect(media.json().data.description).toContain("sensitive traits");
    const denied = await app.inject({ method: "GET", url: "/admin/metrics" });
    expect(denied.statusCode).toBe(401);
    const allowed = await app.inject({ method: "GET", url: "/admin/metrics", headers: { "x-admin-key": "local-admin-key-change-me" } });
    expect(allowed.statusCode).toBe(200);
    expect(JSON.stringify(allowed.json())).not.toContain("interview was today");
  });
});
