import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { StoreEngine, type SqlStorage } from "./store-engine";
import { ReminderEngine } from "./reminder-engine";
import {
  DEFAULT_REMINDER,
  nextDaily,
  nextEvent,
  parsePushDevice,
  parseReminderRule,
  type ReminderRule,
} from "./reminders";
import { freshDemo } from "./demo-storage";
import {
  createPushKeys,
  deliverReminders,
  pushBase64,
} from "./reminder-delivery";

const base: ReminderRule = {
  ...DEFAULT_REMINDER,
  id: "daily",
  kind: "daily",
  timezone: "UTC",
};
afterEach(() => vi.useRealTimers());
describe("reminder wall-clock scheduling", () => {
  it("uses the selected time zone and handles midnight quiet hours in the correct day", () => {
    expect(
      new Date(
        nextDaily(
          { ...base, time: "19:00", timezone: "Asia/Kolkata" },
          Date.parse("2026-09-24T12:00:00Z"),
        ),
      ).toISOString(),
    ).toBe("2026-09-24T13:30:00.000Z");
    expect(
      new Date(
        nextDaily(
          { ...base, time: "23:00" },
          Date.parse("2026-09-24T06:00:00Z"),
        ),
      ).toISOString(),
    ).toBe("2026-09-25T08:00:00.000Z");
    expect(
      new Date(
        nextDaily(
          { ...base, time: "23:00" },
          Date.parse("2026-09-25T08:00:00Z"),
        ),
      ).toISOString(),
    ).toBe("2026-09-26T08:00:00.000Z");
  });
  it("handles DST gaps and prevents a repeated-hour second daily notification", () => {
    const rule = {
      ...base,
      timezone: "America/New_York",
      time: "02:30",
      quietStart: "00:00",
      quietEnd: "00:00",
    };
    expect(
      new Date(
        nextDaily(rule, Date.parse("2026-03-08T05:00:00Z")),
      ).toISOString(),
    ).toBe("2026-03-08T07:00:00.000Z");
    expect(
      new Date(
        nextDaily(
          { ...rule, time: "01:30" },
          Date.parse("2026-11-01T05:31:00Z"),
          "2026-11-01",
        ),
      ).toISOString(),
    ).toBe("2026-11-02T06:30:00.000Z");
  });
  it("never moves a quiet-hour reminder after the event", () => {
    expect(
      nextEvent(
        { ...base, kind: "event", minutesBefore: 60 },
        Date.parse("2026-09-25T07:00:00Z"),
        Date.parse("2026-09-24T00:00:00Z"),
      ),
    ).toBeNull();
    expect(
      nextEvent(
        { ...base, kind: "event", minutesBefore: 60 },
        Date.parse("2026-09-25T08:00:00Z"),
        Date.parse("2026-09-24T00:00:00Z"),
      ),
    ).toBe(Date.parse("2026-09-25T08:00:00Z"));
  });
  it("rejects SSRF endpoints, malformed keys, invalid times and unknown zones", () => {
    for (const endpoint of [
      "http://fcm.googleapis.com/x",
      "https://localhost/x",
      "https://fcm.googleapis.com.evil.test/x",
      "https://name@fcm.googleapis.com/x",
      "https://fcm.googleapis.com:444/x",
    ])
      expect(() =>
        parsePushDevice({ endpoint, keys: { p256dh: "x", auth: "x" } }),
      ).toThrow();
    expect(() => parseReminderRule({ ...base, time: "25:00" })).toThrow();
    expect(() =>
      parseReminderRule({ ...base, timezone: "Not/AZone" }),
    ).toThrow();
    expect(parseReminderRule({ ...base, id: "other-user-rule" }).id).toBe(
      "daily",
    );
  });
});
describe("durable opt-in and delivery", () => {
  function fixture() {
    const db = new DatabaseSync(":memory:");
    const sql: SqlStorage = {
      exec(query, ...values) {
        const rows = db.prepare(query).all(...values) as Record<
          string,
          unknown
        >[];
        return { toArray: () => rows };
      },
    };
    const store = new StoreEngine(sql),
      engine = new ReminderEngine(sql, store),
      state = freshDemo();
    state.user.adultConfirmed = true;
    store.bootstrap(
      "email:u",
      { id: "u" },
      state,
      "session:x",
      '{"userId":"u"}',
      86400,
    );
    return { db, sql, store, engine };
  }
  async function device(suffix: string) {
    const key = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    );
    return {
      endpoint: `https://fcm.googleapis.com/fcm/send/${suffix}`,
      keys: {
        p256dh: pushBase64(
          new Uint8Array(await crypto.subtle.exportKey("raw", key.publicKey)),
        ),
        auth: pushBase64(crypto.getRandomValues(new Uint8Array(16))),
      },
    };
  }
  it("requires explicit device opt-in; rule and device deletion are owner scoped", async () => {
    const { db, engine } = fixture();
    try {
      expect(() => engine.save("u", base)).toThrow(/Enable/);
      engine.subscribe("u", "device", await device("one"));
      engine.save("u", base);
      engine.remove("other", "daily");
      engine.unsubscribe("other", "device");
      expect(engine.snapshot("u").rules).toHaveLength(1);
      expect(engine.devices("u")).toHaveLength(1);
      engine.unsubscribe("u");
      expect(engine.nextAlarm()).toBeNull();
      expect(engine.snapshot("u").rules[0]?.enabled).toBe(false);
    } finally {
      db.close();
    }
  });
  it("retries only failed devices, uses encryption and stops after account deletion", async () => {
    const { db, sql, engine, store } = fixture();
    try {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-24T18:59:00Z"));
      engine.subscribe("u", "one", await device("one"));
      engine.subscribe("u", "two", await device("two"));
      engine.save("u", base);
      vi.setSystemTime(new Date("2026-09-24T19:00:00Z"));
      const keys = await createPushKeys("https://mira.example");
      const calls: string[] = [];
      const sender = vi.fn(
        async (url: RequestInfo | URL, init?: RequestInit) => {
          calls.push(String(url));
          expect(new Headers(init?.headers).get("content-encoding")).toBe(
            "aes128gcm",
          );
          expect(init?.redirect).toBe("manual");
          return new Response(null, {
            status:
              String(url).endsWith("two") && calls.length === 2 ? 503 : 201,
          });
        },
      ) as unknown as typeof fetch;
      await deliverReminders(engine, keys, (fn) => fn(), sender);
      expect(calls).toHaveLength(2);
      vi.setSystemTime(new Date("2026-09-24T19:01:00Z"));
      await deliverReminders(engine, keys, (fn) => fn(), sender);
      expect(calls.filter((url) => url.endsWith("one"))).toHaveLength(1);
      expect(calls.filter((url) => url.endsWith("two"))).toHaveLength(2);
      store.eraseAccount("u", "u", []);
      sql.exec("UPDATE reminder_rules SET next_at=?", Date.now());
      await deliverReminders(engine, keys, (fn) => fn(), sender);
      expect(calls).toHaveLength(3);
      expect(engine.devices("u")).toHaveLength(0);
    } finally {
      db.close();
    }
  });
  it("preserves retries on unrelated saves and reschedules edited plans", async () => {
    const { db, engine, store, sql } = fixture();
    try {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-24T18:00:00Z"));
      const state = store.readAccountState("u")!.state;
      state.futureEvents = [
        {
          id: "plan",
          userId: "u",
          companionId: state.companion.id,
          description: "Synthetic plan",
          eventDate: "2026-09-24T20:00:00Z",
          status: "confirmed",
          createdAt: new Date().toISOString(),
        },
      ];
      store.saveAccountState("u", state, store.readAccountState("u")!.revision);
      engine.subscribe("u", "one", await device("one"));
      engine.save("u", {
        ...base,
        id: "event:plan",
        kind: "event",
        eventId: "plan",
        minutesBefore: 30,
      });
      vi.setSystemTime(new Date("2026-09-24T19:30:00Z"));
      const job = engine.claim()[0]!;
      engine.finish("u", job.rule.id, job.version, "retry");
      engine.syncEvents("u", state);
      expect(engine.snapshot("u").rules[0]!.status).toBe("retrying");
      expect(engine.snapshot("u").rules[0]!.nextAt).toBe(
        Date.parse("2026-09-24T19:31:00Z"),
      );
      state.futureEvents[0]!.eventDate = "2026-09-24T21:00:00Z";
      engine.syncEvents("u", state);
      expect(engine.snapshot("u").rules[0]!.nextAt).toBe(
        Date.parse("2026-09-24T20:30:00Z"),
      );
      expect(
        sql.exec("SELECT version FROM reminder_rules").toArray()[0]!.version,
      ).not.toBe(job.version);
      state.futureEvents = [];
      engine.syncEvents("u", state);
      expect(engine.snapshot("u").rules).toEqual([]);
    } finally {
      db.close();
    }
  });
  it("moves retries beyond quiet hours and lets an at-time plan fire within the scheduler minute", async () => {
    const { db, engine, sql, store } = fixture();
    try {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-24T21:58:00Z"));
      engine.subscribe("u", "one", await device("one"));
      engine.save("u", { ...base, time: "21:59" });
      vi.setSystemTime(new Date("2026-09-24T21:59:00Z"));
      const job = engine.claim()[0]!;
      engine.finish("u", "daily", job.version, "retry");
      expect(engine.snapshot("u").rules[0]!.nextAt).toBe(
        Date.parse("2026-09-25T08:00:00Z"),
      );
      const state = store.readAccountState("u")!.state;
      state.futureEvents = [
        {
          id: "now",
          userId: "u",
          companionId: state.companion.id,
          description: "Synthetic plan",
          eventDate: "2026-09-25T12:00:00Z",
          status: "confirmed",
          createdAt: new Date().toISOString(),
        },
      ];
      store.saveAccountState("u", state, store.readAccountState("u")!.revision);
      engine.save("u", {
        ...base,
        id: "event:now",
        kind: "event",
        eventId: "now",
        minutesBefore: 0,
      });
      sql.exec("DELETE FROM reminder_rules WHERE id='daily'");
      vi.setSystemTime(new Date("2026-09-25T12:00:01Z"));
      expect(engine.claim()).toHaveLength(1);
    } finally {
      db.close();
    }
  });
  it("fences unsubscribe while payload encryption is pending and expires old events", async () => {
    const { db, engine, sql } = fixture();
    try {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-24T19:00:00Z"));
      engine.subscribe("u", "one", await device("one"));
      engine.save("u", base);
      sql.exec("UPDATE reminder_rules SET next_at=?", Date.now() - 31 * 60000);
      const sender = vi.fn() as unknown as typeof fetch;
      await deliverReminders(
        engine,
        await createPushKeys("https://mira.example"),
        (fn) => fn(),
        sender,
      );
      expect(sender).not.toHaveBeenCalled();
      sql.exec("UPDATE reminder_rules SET next_at=?", Date.now());
      const jobs = engine.claim();
      expect(jobs).toHaveLength(1);
      engine.unsubscribe("u", "one");
      expect(engine.active("u", "daily", jobs[0]!.version, "one")).toBe(false);
    } finally {
      db.close();
    }
  });
});
