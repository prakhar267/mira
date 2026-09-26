import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import {
  SELF,
  runInDurableObject,
  runDurableObjectAlarm,
} from "cloudflare:test";
import { cleanupWorkerState } from "./cleanup.mjs";
import { freshDemo } from "../../lib/demo-storage.ts";
import { pushBase64 } from "../../lib/reminder-delivery.ts";
const origin = "http://localhost:4173";
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("External network forbidden");
    }),
  );
});
afterEach(async () => {
  await cleanupWorkerState();
  vi.unstubAllGlobals();
});
async function request(path, cookie, body, method = body ? "POST" : "GET") {
  const response = await SELF.fetch(origin + path, {
    method,
    headers: {
      origin,
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return new Response(await response.arrayBuffer(), {
    status: response.status,
    headers: response.headers,
  });
}
async function signup(index = 1) {
  const state = freshDemo();
  state.user.adultConfirmed = true;
  state.journalEntries = [
    {
      id: "entry-one",
      userId: "seed",
      title: "Sketching",
      content: "I finished a drawing.",
      mood: "calm",
      tags: [],
      reflected: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "entry-two",
      userId: "seed",
      title: "Private unselected",
      content: "This entry must not be sent for reflection.",
      mood: "thoughtful",
      tags: [],
      reflected: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];
  state.messages = Array.from({ length: 300 }, (_, i) => ({
    id: `message-${i}`,
    conversationId: state.activeConversationId,
    role: "user",
    content:
      i === 0 ? "Oldest conversation about Pune" : "Another synthetic message",
    createdAt: new Date(1700000000000 + i * 1000).toISOString(),
    status: "sent",
  }));
  const response = await request("/api/account/signup", null, {
    email: `tools-${index}@example.test`,
    password: "Synthetic-tools-password1!",
    name: "Synthetic adult",
    state,
    policy: {
      termsVersion: "2026-09-13",
      adultConfirmed: true,
      aiProcessingConsent: true,
    },
  });
  expect(response.status).toBe(201);
  return {
    ...(await response.json()),
    cookie: response.headers.get("set-cookie").split(";")[0],
  };
}
const stub = () =>
  env.MIRA_STORE.get(env.MIRA_STORE.idFromName("mira-production-v1"));
describe("new companion features in real workerd", () => {
  it("reports the real provider quota envelope clearly for reflections and chat", async () => {
    const user = await signup();
    user.state.journalEntries[0].content = "[synthetic-provider-quota]";
    expect((await request("/api/account/state", user.cookie, { state: user.state, revision: user.revision }, "PUT")).status).toBe(200);
    const reflection = await request("/api/journal-reflection", user.cookie, { entryIds: ["entry-one"] });
    expect(reflection.status).toBe(429); expect(await reflection.json()).toMatchObject({ code: "PROVIDER_DAILY_QUOTA", error: expect.stringContaining("00:00 UTC") });
    expect(Number(reflection.headers.get("retry-after"))).toBeGreaterThan(0);
    const chat = await request("/api/companion-chat", user.cookie, { user: { name: "Synthetic" }, companion: { name: "Mira" }, messages: [{ role: "user", content: "[synthetic-provider-quota] I drew a tree." }], delivery: "text" });
    expect(chat.status).toBe(429); expect(await chat.json()).toMatchObject({ code: "PROVIDER_DAILY_QUOTA" });
  });
  it("searches older messages across the stored history and enforces account ownership", async () => {
    const first = await signup(1),
      second = await signup(2);
    expect(
      first.state.messages.some((message) => message.id === "message-0"),
    ).toBe(true);
    const loaded = await (
      await request("/api/account/state", first.cookie)
    ).json();
    expect(
      loaded.state.messages.some((message) => message.id === "message-0"),
    ).toBe(false);
    const results = await (
      await request("/api/account/search?q=Pune", first.cookie)
    ).json();
    expect(results.messages).toHaveLength(1);
    expect(results.messages[0].conversationId).toBe(
      first.state.activeConversationId,
    );
    const others = await (
      await request(
        `/api/account/search?q=Pune&conversationId=${first.state.activeConversationId}`,
        second.cookie,
      )
    ).json();
    expect(others.messages).toEqual([]);
    const context = await (
      await request("/api/account/search?messageId=message-0", first.cookie)
    ).json();
    expect(context.messages[0].id).toBe("message-0");
    const deletion = await request("/api/account/conversation", first.cookie, {
      command: { action: "delete", id: first.state.activeConversationId },
      revision: 1,
    });
    expect(deletion.status).toBe(200);
    expect(
      (await (await request("/api/account/search?q=Pune", first.cookie)).json())
        .messages,
    ).toEqual([]);
    expect((await request("/api/account/search?q=Pune")).status).toBe(401);
  });
  it("reflects only canonical selected entries and respects withdrawn consent", async () => {
    const user = await signup();
    const response = await request("/api/journal-reflection", user.cookie, {
      entryIds: ["entry-one"],
      entries: [{ id: "entry-one", title: "Forged", content: "forged" }],
      language: "English",
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.summary).toContain("Sketching");
    expect(body.summary).not.toContain("unselected");
    expect(body.summary).not.toContain("Forged");
    expect(
      (
        await request("/api/journal-reflection", user.cookie, {
          entryIds: ["missing"],
        })
      ).status,
    ).toBe(409);
    const state = { ...user.state, aiProcessingConsent: false };
    expect(
      (
        await request(
          "/api/account/state",
          user.cookie,
          { state, revision: 1 },
          "PUT",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request("/api/journal-reflection", user.cookie, {
          entryIds: ["entry-one"],
        })
      ).status,
    ).toBe(403);
  });
  it("lists system voices, previews cached samples and honors selection in both speech formats", async () => {
    const user = await signup();
    const catalog = await request("/api/voices", user.cookie);
    expect(catalog.status).toBe(200);
    expect((await catalog.json()).voices.map((voice) => voice.id)).toContain(
      "Ashley",
    );
    const preview = await request(
      "/api/voices/preview?voiceId=Ashley",
      user.cookie,
    );
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-type")).toBe("audio/mpeg");
    const voice = await request("/api/companion-speech", user.cookie, {
      text: "Hello from the synthetic test.",
      voiceId: "Ashley",
    });
    expect(voice.status).toBe(200);
    expect(voice.headers.get("x-companion-voice")).toBe("Ashley");
    expect(
      (
        await request("/api/companion-speech", user.cookie, {
          text: "Hello",
          voiceId: "unknown-private-clone",
        })
      ).status,
    ).toBe(422);
    const state = {
      ...user.state,
      companion: { ...user.state.companion, voiceId: "Ashley" },
    };
    expect(
      (
        await request(
          "/api/account/state",
          user.cookie,
          { state, revision: 1 },
          "PUT",
        )
      ).status,
    ).toBe(200);
    const speech = await SELF.fetch(origin + "/api/companion-speech", {
      method: "POST",
      headers: {
        origin,
        cookie: user.cookie,
        "content-type": "application/json",
        "x-mira-audio-stream": "1",
      },
      body: JSON.stringify({ text: "Hello again" }),
    });
    expect(speech.status).toBe(200);
    expect(speech.headers.get("x-companion-voice")).toBe("Ashley");
    await speech.arrayBuffer();
  });
  it("persists opt-in subscriptions, sends through the isolated provider, and erases on deletion", async () => {
    const user = await signup();
    const config = await (
      await request("/api/account/reminders", user.cookie)
    ).json();
    expect(config.publicKey).toHaveLength(87);
    expect(config.devices).toEqual([]);
    const key = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    );
    const subscription = {
      endpoint: "https://fcm.googleapis.com/fcm/send/synthetic-only",
      keys: {
        p256dh: pushBase64(
          new Uint8Array(await crypto.subtle.exportKey("raw", key.publicKey)),
        ),
        auth: pushBase64(crypto.getRandomValues(new Uint8Array(16))),
      },
    };
    const subscribed = await request("/api/account/reminders", user.cookie, {
      action: "subscribe",
      subscription,
    });
    expect(subscribed.status).toBe(200);
    const save = await request("/api/account/reminders", user.cookie, {
      action: "save",
      rule: {
        kind: "daily",
        enabled: true,
        timezone: "UTC",
        time: "19:00",
        quietStart: "00:00",
        quietEnd: "00:00",
        minutesBefore: 30,
      },
    });
    expect(save.status).toBe(200);
    await runInDurableObject(stub(), (_instance, ctx) =>
      ctx.storage.sql.exec(
        "UPDATE reminder_rules SET next_at=?",
        Date.now() - 1000,
      ),
    );
    expect(await runDurableObjectAlarm(stub())).toBe(true);
    const snapshot = await (
      await request("/api/account/reminders", user.cookie)
    ).json();
    expect(snapshot.rules[0].status).toBe("sent");
    expect(snapshot.rules[0].nextAt).toBeGreaterThan(Date.now());
    expect(
      (
        await request("/api/account/reminders", user.cookie, {
          action: "subscribe",
          subscription: {
            ...subscription,
            endpoint: "https://127.0.0.1/private",
          },
        })
      ).status,
    ).toBe(400);
    expect(
      (await request("/api/account/delete", user.cookie, undefined, "DELETE"))
        .status,
    ).toBe(200);
    expect(
      await runInDurableObject(stub(), (_instance, ctx) =>
        ctx.storage.sql.exec("SELECT * FROM reminder_devices").toArray(),
      ),
    ).toEqual([]);
    expect(
      await runInDurableObject(stub(), (_instance, ctx) =>
        ctx.storage.sql.exec("SELECT * FROM reminder_rules").toArray(),
      ),
    ).toEqual([]);
  });
});
