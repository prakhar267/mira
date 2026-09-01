import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createServer } from "../src/server";

let app: FastifyInstance;
let accessToken = "";
let refreshToken = "";
let userId = "";
let companionId = "";
let conversationId = "";

beforeAll(async () => {
  process.env.APP_ENV = "test";
  process.env.AI_MOCK_MODE = "false";
  process.env.PERSISTENCE_PROVIDER = "memory";
  process.env.QUEUE_PROVIDER = "memory";
  process.env.STORAGE_PROVIDER = "memory";
  process.env.BILLING_ENABLED = "false";
  app = await createServer();
});

afterAll(async () => {
  await app.close();
  process.env.AI_MOCK_MODE = "true";
});

describe("production-mode API journey", () => {
  it("creates an account with real signed sessions", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: {
        email: "journey@example.com",
        password: "correct-horse-battery-staple",
        name: "Asha",
        birthday: "1997-05-17",
        pronouns: "she/her",
        adultConfirmed: true,
        goals: ["feel supported"],
        interests: ["music", "books"],
        companionName: "Luma",
        companionPronouns: "she/her",
        relationshipMode: "friend",
      },
    });
    expect(response.statusCode).toBe(201);
    const data = response.json().data;
    accessToken = data.accessToken;
    refreshToken = data.refreshToken;
    userId = data.user.id;
    companionId = data.companion.id;
    expect(accessToken.split(".")).toHaveLength(2);
    expect(data.mockVerificationToken).toBeUndefined();
  });

  it("rejects anonymous access and accepts the signed access token", async () => {
    const denied = await app.inject({ method: "GET", url: "/users/me" });
    expect(denied.statusCode).toBe(401);
    const accepted = await app.inject({ method: "GET", url: "/users/me", headers: { authorization: `Bearer ${accessToken}` } });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().data.id).toBe(userId);
  });

  it("creates a conversation and streams a contextual response", async () => {
    const conversation = await app.inject({ method: "POST", url: "/conversations", headers: { authorization: `Bearer ${accessToken}` }, payload: { companionId } });
    expect(conversation.statusCode).toBe(201);
    conversationId = conversation.json().data.id;

    const chat = await app.inject({
      method: "POST",
      url: "/chat/stream",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { conversationId, companionId, clientMessageId: "journey-message-0001", content: "I had a long day and want someone to listen." },
    });
    expect(chat.statusCode).toBe(200);
    expect(chat.headers["content-type"]).toContain("text/event-stream");
    expect(chat.body).toContain("event: token");
    expect(chat.body).toContain("event: done");

    const messages = await app.inject({ method: "GET", url: `/conversations/${conversationId}/messages`, headers: { authorization: `Bearer ${accessToken}` } });
    expect(messages.json().data).toHaveLength(2);
  });

  it("creates working realtime voice, video, camera, and media sessions", async () => {
    const voice = await app.inject({ method: "POST", url: "/voice/session", headers: { authorization: `Bearer ${accessToken}` }, payload: { companionId } });
    expect(voice.statusCode).toBe(200);
    expect(voice.json().data.clientSecret).toMatch(/^mock-realtime\./);

    const video = await app.inject({ method: "POST", url: "/video/session", headers: { authorization: `Bearer ${accessToken}` }, payload: { companionId, cameraEnabled: true } });
    expect(video.statusCode).toBe(201);
    expect(video.json().data.realtime.clientSecret).toMatch(/^mock-realtime\./);

    const camera = await app.inject({ method: "POST", url: "/camera/session", headers: { authorization: `Bearer ${accessToken}` } });
    expect(camera.statusCode).toBe(200);
    expect(camera.json().data.consentRequired).toBe(true);

    const upload = await app.inject({ method: "POST", url: "/media/upload", headers: { authorization: `Bearer ${accessToken}` }, payload: { name: "photo.png", contentType: "image/png", dataBase64: "iVBORw0KGgo=" } });
    expect(upload.statusCode).toBe(201);
    expect(upload.json().data.bytes).toBeGreaterThan(0);
  });

  it("rotates refresh tokens once", async () => {
    const rotated = await app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken } });
    expect(rotated.statusCode).toBe(200);
    const replay = await app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken } });
    expect(replay.statusCode).toBe(401);
  });
});
