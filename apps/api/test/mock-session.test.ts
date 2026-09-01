import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { seedUser } from "@companion/db";
import { createServer } from "../src/server";

let app: FastifyInstance;

beforeAll(async () => {
  process.env.APP_ENV = "test";
  process.env.AI_MOCK_MODE = "true";
  process.env.PERSISTENCE_PROVIDER = "memory";
  process.env.QUEUE_PROVIDER = "memory";
  process.env.STORAGE_PROVIDER = "memory";
  process.env.BILLING_ENABLED = "false";
  app = await createServer();
});

afterAll(async () => app.close());

describe("mock-provider signed sessions", () => {
  it("keeps a signed account isolated from the public seeded demo", async () => {
    const signup = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: {
        email: "mock-isolation@example.com",
        password: "correct-horse-battery-staple",
        name: "Mira",
        birthday: "1994-06-19",
        pronouns: "she/her",
        adultConfirmed: true,
        goals: ["companionship"],
        interests: ["music"],
        companionName: "Nova",
        companionPronouns: "she/her",
        relationshipMode: "friend",
      },
    });
    expect(signup.statusCode).toBe(201);
    const created = signup.json().data;

    const signedUser = await app.inject({ method: "GET", url: "/users/me", headers: { authorization: `Bearer ${created.accessToken}` } });
    expect(signedUser.statusCode).toBe(200);
    expect(signedUser.json().data).toMatchObject({ id: created.user.id, name: "Mira" });

    const signedCompanions = await app.inject({ method: "GET", url: "/companions", headers: { authorization: `Bearer ${created.accessToken}` } });
    expect(signedCompanions.json().data[0]).toMatchObject({ id: created.companion.id, name: "Nova" });

    const exported = await app.inject({ method: "POST", url: "/data/export", headers: { authorization: `Bearer ${created.accessToken}` } });
    expect(exported.json().data.user.id).toBe(created.user.id);
    expect(exported.json().data.companion.id).toBe(created.companion.id);

    const publicDemo = await app.inject({ method: "GET", url: "/users/me" });
    expect(publicDemo.json().data.id).toBe(seedUser.id);
    expect(publicDemo.json().data.id).not.toBe(created.user.id);
  });
});
